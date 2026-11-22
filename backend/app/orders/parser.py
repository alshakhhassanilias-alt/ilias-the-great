"""Offline natural-language interpreter. Turns free-form orders into structured, validated actions.
It understands context (current enemies, subjects, colonies, heritage) so the player never needs templates."""
from __future__ import annotations

import re

from ..util import clamp
from ..world.geo import BODIES, get_geo
from ..world.ideologies import BASE
from ..world.techtree import all_techs
from ..sim.core import at_war, idx, wars_of
from .actions import assess

ALIASES = {
    "britain": ["GBR"], "england": ["GBR"], "uk": ["GBR"], "united kingdom": ["GBR"], "great britain": ["GBR"],
    "america": ["USA"], "us": ["USA"], "usa": ["USA"], "united states": ["USA"], "the states": ["USA"],
    "soviet union": ["SOV"], "ussr": ["SOV"], "soviets": ["SOV"], "russia": ["SOV", "RUS"], "russians": ["SOV", "RUS"],
    "germany": ["GER", "DEU", "FRG"], "germans": ["GER", "DEU"], "reich": ["GER"], "japan": ["JPN"], "china": ["CHN"],
    "france": ["FRA"], "italy": ["ITA"], "poland": ["POL"], "austria": ["AUT", "AUH"], "ottomans": ["OTT"], "turkey": ["TUR", "OTT"],
    "persia": ["PER", "IRN"], "iran": ["IRN", "PER"], "siam": ["THA", "SIA"], "thailand": ["THA", "SIA"], "czechoslovakia": ["CZS"],
    "yugoslavia": ["YUG"], "west germany": ["FRG"], "east germany": ["GDR"], "korea": ["KOR"], "north korea": ["PRK"], "south korea": ["KOR"],
}
REGIONS = {"european": "Europe", "asian": "Asia", "african": "Africa", "latin american": "South America", "middle eastern": "Western Asia",
           "europe": "Europe", "asia": "Asia", "africa": "Africa", "north america": "North America", "south america": "South America",
           "latin america": "South America", "the americas": "Americas", "oceania": "Oceania", "the world": "World", "the planet": "World",
           "the globe": "World", "earth": "World", "middle east": "Western Asia", "scandinavia": "Northern Europe", "the balkans": "Southern Europe"}
BODY_WORDS = {"moon": "luna", "luna": "luna", "lunar": "luna", "mars": "mars", "martian": "mars", "red planet": "mars", "asteroid": "belt",
              "asteroids": "belt", "belt": "belt", "ceres": "belt", "venus": "venus", "europa": "jovian", "jupiter": "jovian", "ganymede": "jovian",
              "titan": "saturnian", "saturn": "saturnian", "proxima": "proxima", "alpha centauri": "proxima", "tau ceti": "tau_ceti",
              "trappist": "trappist", "another star": "proxima", "other stars": "proxima"}
CAT_WORDS = {"military": "military", "weapon": "military", "computer": "computing", "computing": "computing", "ai": "computing",
             "artificial intelligence": "computing", "energy": "energy", "fusion": "energy", "power": "energy", "biolog": "biology",
             "medicine": "biology", "genetic": "biology", "space": "space", "rocket": "space", "industr": "industry", "manufactur": "industry",
             "social": "society", "society": "society"}
GOV_WORDS = [
    ("planetary government", "planetarism", "Planetary Government", "Planetary Chancellor"), ("world government", "planetarism", "World Government", "Planetary Chancellor"),
    ("global government", "planetarism", "Global Government", "Planetary Chancellor"), ("ai administration", "algorithmic_governance", "AI Administration", "Administrator"),
    ("artificial intelligence administration", "algorithmic_governance", "AI Administration", "Administrator"),
    ("digital republic", "substrate_egalitarianism", "Digital Republic", "First Speaker"), ("technocracy", "technocracy", "Technocratic Directorate", "Director"),
    ("theocracy", "theocracy", "Theocracy", "High Priest"), ("communist", "communism", "Socialist Republic", "Chairman"), ("socialist", "social_democracy", None, None),
    ("democracy", "liberal_democracy", "Parliamentary Republic", "President"), ("republic", "liberal_democracy", "Republic", "President"),
    ("constitutional monarchy", "constitutional_monarchy", "Constitutional Monarchy", "King"), ("monarchy", "absolute_monarchy", "Monarchy", "King"),
    ("kingdom", "absolute_monarchy", "Kingdom", "King"), ("imperial federation", "imperial_federalism", "Imperial Federation", "Emperor"),
    ("empire", "imperial_federalism", "Empire", "Emperor"), ("dictatorship", "military_junta", "Dictatorship", "Dictator"),
    ("corporate", "corporatocracy", "Corporate Charter State", "Chairman of the Board"), ("collective consciousness", "collective_unity", "Collective Consciousness", "Voice of the Collective"),
    ("federation", "liberal_democracy", "Federation", "President"), ("fascis", "fascism", "Fascist State", "Leader"),
]


def country_index(state: dict) -> list[tuple[str, str]]:
    """(phrase, tag) pairs, longest first, alive countries preferred."""
    pairs = []
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        for s in {c["name"].lower(), c["adj"].lower(), t.lower()}:
            if len(s) >= 2:
                pairs.append((s, t))
        n = c["name"].lower()
        for pre in ("republic of ", "kingdom of ", "empire of ", "the ", "federal republic of ", "people's republic of "):
            if n.startswith(pre):
                pairs.append((n[len(pre):], t))
    for alias, tags in ALIASES.items():
        for t in tags:
            if state["countries"].get(t, {}).get("alive"):
                pairs.append((alias, t))
                break
    pairs.sort(key=lambda p: -len(p[0]))
    return pairs


def find_countries(state: dict, text: str, exclude: str | None = None) -> list[str]:
    low = " " + re.sub(r"[^\w\s'-]", " ", text.lower()) + " "
    found = []
    taken = []
    for phrase, tag in country_index(state):
        if tag == exclude and phrase not in ("us",):
            pass
        pat = r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])"
        for mt in re.finditer(pat, low):
            span = mt.span()
            if any(not (span[1] <= a or span[0] >= b) for a, b in taken):
                continue
            if phrase in ("us",) and not re.search(r"\b(the us|us forces|us government|with the us)\b", low):
                continue
            if len(phrase) <= 3 and phrase == tag.lower() and not re.search(r"\b" + phrase.upper() + r"\b", text):
                continue
            taken.append(span)
            if tag != exclude and tag not in found:
                found.append(tag)
    return found


def find_provinces(state: dict, text: str, owner_filter=None) -> list[str]:
    geo = get_geo()
    low = text.lower()
    out = []
    for pid, p in state["provinces"].items():
        nm = geo.provinces[pid]["name"] if pid in geo.provinces else state.get("extra_geo", {}).get(pid, {}).get("name", "")
        n = nm.lower().replace(" region", "")
        if len(n) >= 4 and re.search(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])", low):
            if owner_filter is None or p["owner"] in owner_filter:
                out.append(pid)
    # modern country names name groups of provinces (e.g. "India", "Alsace" via "Grand Est")
    for code, info in geo.countries.items():
        n = info["name"].lower()
        if len(n) >= 4 and re.search(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])", low):
            for pid in geo.by_modern.get(code, []):
                if (owner_filter is None or state["provinces"][pid]["owner"] in owner_filter) and pid not in out:
                    out.append(pid)
    return out


def _percent(text: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(%|percent|per cent)", text.lower())
    return float(m.group(1)) / 100 if m else None


def _quoted_name(text: str) -> str | None:
    m = re.search(r"[\"“']([^\"”']{3,60})[\"”']", text)
    if m:
        return m.group(1).strip()
    m = re.search(r"\b(?:called|named|titled|known as)\s+(?:the\s+)?([A-Z][\w'-]*(?:\s+(?:of|the|and|[A-Z][\w'-]*))*)", text)
    if m:
        return m.group(1).strip().rstrip(".")
    return None


def _continent_members(state: dict, region: str, exclude: str) -> list[str]:
    geo = get_geo()
    out = []
    for t, c in state["countries"].items():
        if not c["alive"] or t == exclude:
            continue
        cap = c["capital"]
        if cap in geo.provinces:
            code = geo.provinces[cap]["country"]
            cont = geo.countries.get(code, {}).get("continent")
            sub = geo.countries.get(code, {}).get("subregion", "")
            if region == "World" or cont == region or sub == region or (region == "Americas" and cont in ("North America", "South America")):
                out.append(t)
    return out


def _region_provinces(state: dict, region: str) -> list[str]:
    geo = get_geo()
    out = []
    for pid, p in state["provinces"].items():
        if p["body"] != "earth" or not p["owner"]:
            continue
        code = p["code"]
        cont = geo.countries.get(code, {}).get("continent")
        sub = geo.countries.get(code, {}).get("subregion", "")
        if region == "World" or cont == region or sub == region or (region == "Americas" and cont in ("North America", "South America")):
            out.append(pid)
    return out


def _find_tech(state: dict, text: str) -> str | None:
    low = text.lower()
    best = None
    for tid, t in all_techs(state).items():
        n = t["name"].lower()
        if n in low or tid.replace("_", " ") in low:
            if not best or len(n) > len(all_techs(state)[best]["name"]):
                best = tid
    syn = {"interstellar propulsion": "interstellar_probes", "interstellar travel": "interstellar_colonization", "atomic bomb": "nuclear_weapons",
           "nuclear bomb": "nuclear_weapons", "agi": "artificial_general_intelligence", "mind upload": "digital_consciousness",
           "upload": "digital_consciousness", "fusion": "fusion_power", "computers": "electronic_computer", "jet": "jet_engine",
           "rockets": "rocketry", "space travel": "crewed_spaceflight", "warp": "metric_engineering", "faster than light": "metric_engineering",
           "terraform": "terraforming", "robot": "autonomous_robotics", "quantum": "quantum_computing", "nanotech": "nanofabrication"}
    if not best:
        for k, v in syn.items():
            if re.search(r"\b" + re.escape(k), low) and v in all_techs(state):
                return v
    return best


def _body(text: str) -> str | None:
    low = text.lower()
    for k in sorted(BODY_WORDS, key=len, reverse=True):
        if re.search(r"\b" + re.escape(k) + r"\b", low):
            return BODY_WORDS[k]
    return None


def split_clauses(text: str) -> list[str]:
    parts = re.split(r"(?:;|\.\s+|\bthen\b|\balso\b|\n)", text)
    out = []
    verbs = r"(declare|invade|attack|conquer|make|sign|propose|form|create|establish|found|build|invest|research|develop|grant|give|allow|colonize|colonise|settle|send|move|rename|pass|enact|introduce|begin|start|launch|set|raise|cut|increase|reduce|transfer|dismantle|abolish|adopt|proclaim|declare|spy|sabotage|demand|annex|ally|improve|befriend|sanction|release|unify|reunify|celebrate|hold)"
    for p in parts:
        p = p.strip(" ,.")
        if not p:
            continue
        sub = re.split(r"\s+and\s+(?=" + verbs + r"\b)", p, flags=re.I)
        out += [s.strip(" ,.") for s in sub if s.strip(" ,.")]
    return out


def interpret(state: dict, actor: str, text: str) -> dict:
    actions = []
    notes = []
    seen = set()
    for clause in split_clauses(text):
        acts, note = interpret_clause(state, actor, clause)
        for a in acts:
            key = repr(sorted((k, str(v)) for k, v in a.items()))
            if key not in seen:
                seen.add(key)
                actions.append(a)
        if note:
            notes.append(note)
    clarify = None
    if not actions:
        clarify = "I could not identify a concrete action. Could you say what the state should do - for example declare war on X, sign a treaty with Y, invest N% of GDP in research, or found a colony on Mars?"
    plan = {"text": text, "actions": [], "notes": notes, "clarify": clarify, "interpreter": "offline"}
    for a in actions:
        r = assess(state, actor, dict(a))
        plan["actions"].append({**a, "assessment": r, "summary": describe(state, a)})
    return plan


def describe(state: dict, a: dict) -> str:
    t = a["type"]
    n = lambda tag: state["countries"].get(tag, {}).get("name", tag)
    if t == "declare_war":
        return f"Declare war on {n(a['target'])} ({a.get('goal', 'conquest')})"
    if t == "make_peace":
        return f"Seek peace with {n(a['target'])} ({a.get('terms', 'white')})"
    if t == "propose_treaty":
        return f"Propose a {a.get('treaty', 'alliance').replace('_', ' ')} to {n(a['target'])}"
    if t == "set_budget":
        return f"Set {a['category']} spending to {a['value'] * 100:.1f}% of GDP"
    if t == "research":
        return f"Research {all_techs(state)[a['tech']]['name']}" if a.get("tech") in all_techs(state) else f"Focus research on {a.get('category')}"
    if t == "colonize":
        return f"Found a settlement on {BODIES.get(a.get('body'), {}).get('name', a.get('body'))}"
    if t == "create_organization":
        return f"Found the {a.get('name')} ({a.get('kind')}) with {len(a.get('members', []))} invited states"
    if t == "national_initiative":
        return f"Launch programme: {a.get('name')}"
    if t == "change_government":
        return f"Reorganise the state as a {a.get('gov') or a.get('ideology')}"
    if t == "create_ideology":
        return f"Proclaim a new ideology: {a.get('name') or '(to be named)'}"
    if t == "pass_law":
        return f"Enact: {a.get('name')}"
    if t == "dismantle_empire":
        return f"{a.get('mode', 'dismantle').title()} the state into successor states"
    if t == "grant_independence":
        return f"Grant independence to {len(a.get('provinces', []))} province(s)"
    if t == "megaproject":
        return f"Megaproject: {a.get('kind', '').replace('_', ' ')}"
    if t == "espionage":
        return f"Covert operation ({a.get('op')}) against {n(a.get('target'))}"
    if t == "strategic_goal":
        return f"Strategic objective: {a.get('mission', {}).get('title')}"
    return t.replace("_", " ").capitalize() + (f": {n(a['target'])}" if a.get("target") else "")


def _axes_from_text(text: str) -> dict:
    low = text.lower()
    ax = {"econ": 0.0, "auth": 0.0, "prog": 0.3, "central": 0.0, "substrate": 0.0}
    rules = [("market|capital|trade|entrepreneur", "econ", 0.6), ("collective|common|shared|communal|equality|socialis", "econ", -0.6),
             ("order|discipline|authority|unity|obedien|strong state|hierarch", "auth", 0.6), ("liberty|freedom|democra|individual|consent", "auth", -0.6),
             ("tradition|heritage|ancestr|faith|religio|restor", "prog", -0.7), ("progress|future|technolog|transcend|science|evolution", "prog", 0.6),
             ("federal|local|decentral|autonom", "central", -0.6), ("central|unitary|imperial|planetary", "central", 0.6),
             ("digital|machine|ai|upload|post-human|posthuman|substrate|cyborg", "substrate", 0.8), ("human|natural|organic|biolog", "substrate", -0.5)]
    for pat, k, v in rules:
        if re.search(pat, low):
            ax[k] = clamp(ax[k] + v, -1, 1)
    return ax


def interpret_clause(state: dict, actor: str, clause: str) -> tuple[list[dict], str | None]:
    low = clause.lower()
    c = state["countries"][actor]
    others = find_countries(state, clause, exclude=actor)
    pct = _percent(clause)
    name = _quoted_name(clause)
    body = _body(clause)
    tech = _find_tech(state, clause)
    A = []
    # --- peace
    if re.search(r"\b(make peace|peace (with|treaty|deal)|ceasefire|armistice|end the war|sue for peace|negotiate (an end|peace))\b", low):
        targets = others or [w["lead_def"] if actor in w["att"] else w["lead_att"] for w in wars_of(state, actor)]
        terms = "white"
        if re.search(r"\b(annex|cede|territor|demand)", low):
            terms = "annex_occupied"
        elif re.search(r"\b(puppet|vassal|subject)", low):
            terms = "puppet"
        elif re.search(r"\b(surrender|capitulat|submit)", low):
            terms = "surrender"
        return [{"type": "make_peace", "target": t, "terms": terms} for t in targets[:3]], None
    # --- war and conquest
    if re.search(r"\b(declare war|go to war|invade|invasion of|attack|conquer|conquest of|subjugate|crush|wage war|war (on|against)|march on|liberate)\b", low):
        goal = "subjugate" if re.search(r"\b(subjugate|puppet|vassal)", low) else "liberation" if "liberat" in low else "conquest"
        region = next((REGIONS[k] for k in sorted(REGIONS, key=len, reverse=True) if re.search(r"\b" + re.escape(k) + r"\b", low)), None)
        if others:
            return [{"type": "declare_war", "target": t, "goal": goal} for t in others[:4]], None
        if body and body != "earth":
            from ..sim.core import total_power
            owners = {p["owner"] for p in state["provinces"].values() if p["body"] == body and p["owner"] and p["owner"] != actor}
            owners = sorted(owners, key=lambda t: (state["countries"][t]["home"] != body, total_power(state["countries"][t])))
            if owners:
                return [{"type": "declare_war", "target": t, "goal": goal,
                         "targets": [pid for pid, p in state["provinces"].items() if p["body"] == body and p["owner"] == t]} for t in owners[:3]], \
                    f"Campaign against the holders of {BODIES[body]['name']}, beginning with the weakest."
        if region:
            members = _continent_members(state, region, actor)
            provs = _region_provinces(state, region)
            from ..sim.core import land_power
            from ..sim.relations import neighbors_of
            nbs = neighbors_of(state, actor)
            first = sorted([m for m in members if m in nbs and not state["countries"][m].get("overlord") == actor], key=lambda m: land_power(state["countries"][m]))
            mission = {"key": f"conquer:{region}:{state['meta']['year']}", "title": f"Conquest of {'the World' if region == 'World' else region}", "category": "military",
                       "desc": f"{c['leader']['name']} has ordered the subjugation of {'the entire world' if region == 'World' else region}. Such a goal is achieved one campaign at a time; the general staff will proceed against the weakest neighbours first.",
                       "importance": "A goal of this scale will reshape the world - and unite it against us.", "objectives": [{"text": f"Control 80% of {'the world' if region == 'World' else region}'s provinces", "cond": {"t": "control", "provinces": provs, "min_share": 0.8}}],
                       "rewards": {"legitimacy": 20, "stability": 10}, "reward_text": "+20 legitimacy", "deadline": state["meta"]["year"] + (60 if region == "World" else 25), "optional": True}
            acts = [{"type": "strategic_goal", "mission": mission}]
            if first:
                acts.append({"type": "declare_war", "target": first[0], "goal": "conquest"})
            return acts, f"'{clause}' is a campaign, not a single act: recorded as a strategic objective" + (f", beginning with {state['countries'][first[0]]['name']}." if first else ".")
        if wars_of(state, actor):
            return [{"type": "set_mobilization", "level": "total"}], "Interpreted as a call for total mobilisation in the current war."
    # --- dismantle / decentralise / reunify
    if re.search(r"\b(dismantle|dissolve|break up|disband|partition)\b.*\b(empire|state|realm|union|federation|reich|ourselves|country|nation)\b", low) or re.search(r"\bsuccessor states?\b", low):
        mode = "collapse" if "collapse" in low else "dismantle"
        if re.search(r"\bpeaceful|gradual|decentrali", low):
            mode = "decentralize" if "decentrali" in low else "dismantle"
        return [{"type": "dismantle_empire", "mode": mode}], None
    if re.search(r"\b(decentrali[sz]e|devolve|federali[sz]e)\b", low):
        if re.search(r"\bempire|state|realm|power\b", low):
            return [{"type": "dismantle_empire", "mode": "decentralize"}], None
        return [{"type": "set_policy", "policy": "integration", "value": "federal"}], None
    if re.search(r"\b(reunif\w*|reunite\w*|restore the (former|old)|unite the former)", low):
        return [{"type": "reunify"}], None
    # --- independence
    if re.search(r"\b(independen|self-rule|home rule|sovereign)\w*", low) and re.search(r"\b(grant|give|allow|create|recogni[sz]e|let|release)\b", low):
        if body:
            ps = [pid for pid, p in state["provinces"].items() if p["owner"] == actor and p["body"] == body]
            if not ps:
                return [], f"We hold no territory on {BODIES[body]['name']} to grant independence to."
            return [{"type": "grant_independence", "provinces": ps, "name": name}], None
        ps = find_provinces(state, clause, owner_filter={actor})
        subj = [t for t in others if state["countries"][t].get("overlord") == actor]
        if subj:
            return [{"type": "release_subject", "target": t} for t in subj], None
        if ps:
            return [{"type": "grant_independence", "provinces": ps, "name": name}], None
        if re.search(r"\bcolon", low):
            ps = [pid for pid, p in state["provinces"].items() if p["owner"] == actor and actor not in p["cores"]]
            return ([{"type": "grant_independence", "provinces": ps}] if ps else []), None
    # --- organisations and federations
    if re.search(r"\b(federation|federal|confederation|union|league|organi[sz]ation|commonwealth|bloc|concord|pact|alliance|community)\b", low) and re.search(r"\b(create|form|found|establish|build|unify|unite|organi[sz]e|bring)\b", low):
        kind = "federation" if re.search(r"\b(federation|federal|union|unify|unite)\b", low) else "economic" if re.search(r"\b(trade|economic|customs|market)\b", low) else "alliance" if re.search(r"\b(alliance|pact|defen)", low) else "international"
        region = next((REGIONS[k] for k in sorted(REGIONS, key=len, reverse=True) if re.search(r"\b" + re.escape(k) + r"\b", low)), None)
        members = list(others)
        if region and not members:
            members = _continent_members(state, region, actor)
        if re.search(r"\ball (successor|former)", low):
            her = {h.get("tag") for h in c.get("heritage", [])}
            members = [t for t, x in state["countries"].items() if x["alive"] and t != actor and ({h.get("tag") for h in x.get("heritage", [])} & her or set(x.get("predecessors", [])) & her)]
        if not name:
            adj = {"Europe": "European", "Asia": "Asian", "Africa": "African", "World": "World", "Americas": "American", "South America": "South American", "North America": "North American"}.get(region or "", c["adj"])
            name = f"{adj} {'Federation' if kind == 'federation' else 'Economic Community' if kind == 'economic' else 'Alliance' if kind == 'alliance' else 'Concord'}"
        return [{"type": "create_organization", "name": name, "kind": kind, "members": members}], None
    # --- treaties
    if re.search(r"\b(alliance|ally with|allies with|defensive pact|mutual defen[cs]e|non-aggression|nonaggression|trade (agreement|deal|treaty|pact)|sign a treaty|treaty with)\b", low) and others:
        if re.search(r"\b(break|cancel|annul|withdraw|renounce|end)\b", low):
            return [{"type": "break_treaty", "target": t} for t in others], None
        tr = "non_aggression" if "aggression" in low else "trade" if "trade" in low else "defensive_pact" if "defen" in low else "alliance"
        secret = bool(re.search(r"\b(secret|covert|backchannel)\b", low))
        return [{"type": "propose_treaty", "target": t, "treaty": tr, "secret": secret, "secret_protocol": secret} for t in others], None
    # --- territorial demands
    if re.search(r"\b(demand|ultimatum)\b", low) and others:
        ps = find_provinces(state, clause, owner_filter=set(others))
        if re.search(r"\b(submit|vassal|puppet|subject|overlord)", low):
            return [{"type": "demand_subjugation", "target": others[0]}], None
        if not ps:
            ps = [p for p in c["claims"] if state["provinces"].get(p, {}).get("owner") == others[0]]
        return [{"type": "demand_territory", "target": others[0], "provinces": ps, "war_if_refused": bool(re.search(r"\bor (else|war)\b", low))}], None
    if re.search(r"\b(annex|absorb|unite with|union with)\b", low) and others:
        return [{"type": "annex_peacefully", "target": t} for t in others], None
    # --- colonisation and space
    if body and re.search(r"\b(coloni[sz]|settle|settlement|colony|colonies|outpost|base|expedition|land on|mission to|occupy)\w*", low):
        if body in ("proxima", "tau_ceti", "trappist"):
            return [{"type": "megaproject", "kind": "interstellar_expedition", "body": body}], None
        ps = find_provinces(state, clause)
        region = next((p for p in ps if state["provinces"][p]["body"] == body), None)
        return [{"type": "colonize", "body": body, "region": region}], None
    if re.search(r"\binterstellar\b", low) and re.search(r"\b(civili[sz]ation|coloni|expedition|empire|settle|first)\w*", low):
        if "interstellar_colonization" in c["techs"]:
            return [{"type": "megaproject", "kind": "interstellar_expedition", "body": "proxima"}], None
        return [{"type": "research", "tech": "interstellar_colonization"}], "Interstellar settlement requires a long chain of breakthroughs; research has been directed toward it."
    if re.search(r"\bterraform", low):
        return [{"type": "megaproject", "kind": "terraform", "body": body or "mars"}], None
    if re.search(r"\b(upload|transfer|digiti[sz]e)\b.*\b(consciousness|minds|humanity|population|citizens)\b", low) or "digital consciousness" in low and re.search(r"\b(all|transfer|mass)\b", low):
        if "digital_consciousness" in c["techs"]:
            return [{"type": "megaproject", "kind": "mass_upload"}], None
        return [{"type": "research", "tech": "digital_consciousness"}], "Mind uploading has not been invented; research has been directed toward Digital Consciousness first."
    if "dyson" in low:
        return [{"type": "megaproject", "kind": "dyson_swarm"}], None
    if re.search(r"space elevator|orbital ring", low):
        return [{"type": "megaproject", "kind": "space_elevator"}], None
    if re.search(r"\b(competition|race|contest|prize)\b", low) and (tech or re.search(r"\b(develop|research)\b", low)):
        acts = [{"type": "national_initiative", "name": f"Grand Challenge: {all_techs(state)[tech]['name'] if tech else 'Frontier Science'}",
                 "effects": {"research": 0.08, "stability": 2}, "years": 5, "cost_share": 0.01, "desc": f"A competition among the nation's institutions and regions: {clause}."}]
        if tech:
            acts.append({"type": "research", "tech": tech})
        return acts, None
    # --- budgets
    if pct is not None and re.search(r"\b(research|science|scientific|technolog|r&d)", low):
        return [{"type": "set_budget", "category": "research", "value": pct}], None
    if pct is not None and re.search(r"\b(military|defen[cs]e|army|armed forces|rearm)", low):
        return [{"type": "set_budget", "category": "military", "value": pct}], None
    if pct is not None and re.search(r"\b(infrastructure|roads|railway|development)", low):
        return [{"type": "set_budget", "category": "infra", "value": pct}], None
    if pct is not None and re.search(r"\b(welfare|health|education|social|pension)", low):
        return [{"type": "set_budget", "category": "welfare", "value": pct}], None
    # --- economy
    if re.search(r"\b(industriali[sz]|industrial (economy|power|base)|largest (industrial )?economy|five[- ]year plan|moderni[sz]e|economic (miracle|growth|development)|grow the economy|rebuild the economy)\w*", low):
        return [{"type": "national_initiative", "name": "National Industrialisation Drive", "kind": "industrialisation", "effects": {"prod": 0.08, "infra": 0.1, "stability": 2},
                 "years": 5, "cost_share": 0.03, "desc": "State-directed investment in heavy industry, energy and transport."},
                {"type": "set_budget", "category": "infra", "value": max(c["budget"].get("infra", 0.02), 0.05)},
                {"type": "research", "category": "industry"}], None
    if re.search(r"\b(planned economy|central planning|collectivi[sz])", low):
        return [{"type": "set_policy", "policy": "economy", "value": "planned"}], None
    if re.search(r"\b(free market|liberali[sz]e|deregulat|privati[sz])", low):
        return [{"type": "set_policy", "policy": "economy", "value": "market"}], None
    if re.search(r"\bautarky|self-sufficien", low):
        return [{"type": "set_policy", "policy": "economy", "value": "autarky"}], None
    if re.search(r"\bpost-scarcity\b", low) and "post_scarcity_economics" in c["techs"]:
        return [{"type": "set_policy", "policy": "economy", "value": "post_scarcity"}], None
    # --- ideology and religion
    if re.search(r"\b(ideology|doctrine|political (philosophy|system|movement)|new (philosophy|worldview))\b", low) and re.search(r"\b(create|found|invent|establish|develop|proclaim|new)\b", low):
        return [{"type": "create_ideology", "name": name, "desc": clause[0].upper() + clause[1:] + ".", "axes": _axes_from_text(clause), "adopt": not re.search(r"\bwithout adopting|but not adopt", low)}], None
    if re.search(r"\b(religion|faith|church|creed|spiritual movement)\b", low) and re.search(r"\b(create|found|establish|start|new)\b", low):
        return [{"type": "found_religion", "name": name or ("Church of " + c["adj"] + " Renewal" if "global" not in low else "The Universal Covenant"), "desc": clause}], None
    # --- laws and rights
    if re.search(r"\b(law|act|decree|bill|constitution|amendment|charter|citizenship|rights)\b", low) and re.search(r"\b(pass|enact|introduce|decree|grant|adopt|establish|create|sign|proclaim)\b", low):
        nm = name or ("Planetary Constitution" if "planetary" in low else "Succession Act" if "succession" in low else re.sub(r"^(introduce|pass|enact|create|establish|adopt|sign|proclaim|decree)\s+(a |an |the )?", "", clause, flags=re.I)[:70].strip().title())
        return [{"type": "pass_law", "name": nm, "text": clause}], None
    # --- government
    if re.search(r"\b(thousand[- ]year|imperial dynasty|dynasty|crown myself|proclaim (an |the )?empire|become (an |the )?empire)\b", low):
        return [{"type": "change_government", "ideology": "imperial_federalism" if "federal" in low else "absolute_monarchy", "gov": "Empire", "title": "Emperor", "hereditary": True},
                {"type": "pass_law", "name": "Imperial Succession Act", "text": "Codifies hereditary succession to the imperial throne."}], None
    if re.search(r"\b(become|transform|turn|reorgani[sz]e|establish|proclaim|declare|convert)\b.*\b(" + "|".join(re.escape(g[0]) for g in GOV_WORDS) + r")\b", low) or re.search(r"\b(establish|create|form) (a |an |the )?(planetary|world|global) government\b", low):
        for word, ide, gov, title in GOV_WORDS:
            if word in low:
                acts = [{"type": "change_government", "ideology": ide, "gov": gov, "title": title}]
                if ide == "planetarism":
                    acts.append({"type": "pass_law", "name": "Planetary Constitution", "text": "Establishes the institutions of a planetary government."})
                return acts, None
    # --- research
    if tech and re.search(r"\b(research|develop|invent|discover|focus|pursue|build|achieve|master|crash program)\w*", low):
        return [{"type": "research", "tech": tech}], None
    if re.search(r"\b(research|science)\b", low):
        cat = next((v for k, v in CAT_WORDS.items() if k in low), None)
        if cat:
            return [{"type": "research", "category": cat}], None
    # --- military
    if re.search(r"\b(mobili[sz]e|total war)\b", low):
        return [{"type": "set_mobilization", "level": "total"}], None
    if re.search(r"\bdemobili[sz]e\b", low):
        return [{"type": "set_mobilization", "level": "none"}, {"type": "set_budget", "category": "military", "value": 0.02}], None
    if re.search(r"\b(build|expand|strengthen|rearm|increase|grow|modernize)\b.*\b(army|navy|fleet|air force|military|armed forces|space fleet|space force)\b", low):
        mix = dict(c["mil_mix"])
        for k, w in (("navy", r"navy|fleet(?! in space)"), ("air", r"air force|aircraft|bomber"), ("space", r"space (fleet|force|navy)"), ("army", r"\barmy\b|divisions")):
            if re.search(w, low):
                mix[k] = mix.get(k, 0) + 0.3
        return [{"type": "set_budget", "category": "military", "value": max(0.06, c["budget"].get("military", 0.03) * 1.6)}, {"type": "set_military_mix", **mix}], None
    # --- administration of territory
    if re.search(r"\b(suppress|crack down|pacify|garrison)\b", low):
        return [{"type": "set_policy", "policy": "integration", "value": "suppress"}], None
    if re.search(r"\bautonomy\b", low):
        if body:
            return [{"type": "set_policy", "policy": "colonial", "value": "autonomy"}], None
        return [{"type": "set_policy", "policy": "integration", "value": "autonomy"}], None
    if re.search(r"\b(assimilat|integrat)\w*", low):
        return [{"type": "set_policy", "policy": "integration", "value": "assimilate"}, {"type": "national_initiative", "name": "Integration Programme", "effects": {"integration": 10, "unrest": -5}, "years": 4, "cost_share": 0.005}], None
    if re.search(r"\b(digital|upload)\w* (rights|citizens)", low):
        return [{"type": "set_policy", "policy": "digital_rights", "value": "equal"}], None
    # --- diplomacy
    if others and re.search(r"\b(improve relations|befriend|reconcil|rapprochement|charm|friendship|apolog|reach out)\w*", low):
        return [{"type": "improve_relations", "target": t} for t in others], None
    if others and re.search(r"\b(sanction|embargo|blockade)\w*", low):
        return [{"type": "sanction", "target": t} for t in others], None
    if others and re.search(r"\b(aid|loan|help|support|subsid)\w*", low):
        return [{"type": "send_aid", "target": t, "share": pct or 0.005} for t in others], None
    if others and re.search(r"\b(threaten|warn|intimidat)\w*", low):
        return [{"type": "threaten", "target": t} for t in others], None
    if re.search(r"\b(spy|spies|espionage|intelligence|covert|infiltrat|sabotage|coup|steal|investigate|backchannel)\w*", low):
        op = "coup" if "coup" in low else "steal_tech" if "steal" in low else "sabotage" if "sabotag" in low else "incite" if re.search(r"incite|unrest|rebel", low) else "investigate"
        return [{"type": "espionage", "target": others[0] if others else actor, "op": op}], None
    if others and re.search(r"\b(release|free)\b", low):
        return [{"type": "release_subject", "target": t} for t in others], None
    # --- identity
    if re.search(r"\b(rename|call (our|the) (country|nation|state)|change (our|the) name)\b", low) and name:
        return [{"type": "rename_country", "name": name}], None
    if re.search(r"\bmove (the |our )?capital\b", low):
        ps = find_provinces(state, clause, owner_filter={actor})
        if ps:
            return [{"type": "move_capital", "province": ps[0]}], None
    if re.search(r"\b(jubilee|celebrat|commemorat|festival|anniversary|triumph)\w*", low):
        return [{"type": "national_initiative", "name": name or "National Jubilee", "kind": "jubilee", "effects": {"stability": 5, "legitimacy": 6}, "years": 0.5, "cost_share": 0.004,
                 "desc": "Nationwide commemorations of the nation's history."}], None
    if re.search(r"\b(succession)\b", low):
        return [{"type": "pass_law", "name": "Succession Act", "text": clause}], None
    # --- fallback: a free-form national programme, never an instant miracle
    words = re.findall(r"[A-Za-z']+", clause)
    if len(words) < 3:
        return [], None
    eff = {"stability": 1}
    if re.search(r"\b(science|technolog|knowledge|education)", low):
        eff["research"] = 0.03
    if re.search(r"\b(econom|wealth|prosper|trade|industr)", low):
        eff["prod"] = 0.02
    if re.search(r"\b(unity|culture|pride|identity|morale)", low):
        eff["stability"] = 3
    nm = " ".join(words[:7]).title()
    return [{"type": "national_initiative", "name": nm, "effects": eff, "years": 4, "cost_share": 0.005, "desc": clause, "kind": "initiative"}], \
        "No specific mechanism matched; interpreted as a national programme with modest, gradual effects."
