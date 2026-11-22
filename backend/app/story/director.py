"""The story director: reads the world each year, detects storylines, names eras, marks anniversaries,
raises crises and keeps the narrative coherent with what has actually happened."""
from __future__ import annotations

from collections import defaultdict

from ..util import clamp, ordinal
from ..world.geo import get_geo
from ..world.ideologies import get_ideology, invent_ideology
from ..sim.core import alive, bloc_of, emit, idx, stab_add, total_power, world_totals
from ..sim.relations import opinion
from .threads import active_threads, close_thread, find_thread, open_thread

ERA_TECHS = [
    ("metric_engineering", "Metric Age"), ("interstellar_colonization", "Interstellar Age"), ("dyson_swarm", "Stellar Age"),
    ("fusion_propulsion", "Solar Age"), ("mars_colonization", "Interplanetary Age"), ("fusion_power", "Fusion Age"),
    ("artificial_general_intelligence", "Age of Thinking Machines"), ("advanced_ai", "Intelligence Age"), ("internet", "Information Age"),
    ("satellites", "Space Age"), ("nuclear_fission", "Atomic Age"), ("mass_production", "Machine Age"), ("industrialization", "Industrial Age"),
    ("scientific_method", "Age of Reason"), ("printing_press", "Early Modern Age"), ("feudal_administration", "Medieval Age"),
    ("iron_working", "Iron Age"), ("bronze_working", "Bronze Age"), ("agriculture", "Age of Antiquity"),
]


def world_era(state: dict) -> str:
    tot = world_totals(state)
    share: dict[str, float] = defaultdict(float)
    for c in state["countries"].values():
        if c["alive"]:
            for t in c["techs"]:
                share[t] += c["gdp"] / tot["gdp"]
    dig = sum(c["pops"].get("dig", 0) for c in state["countries"].values() if c["alive"])
    bio = tot["pop"]
    offworld = sum(p["pop"] for p in state["provinces"].values() if p["body"] != "earth" and p["owner"])
    gen = [t for t in state.get("gen_techs", {}).values() if share.get(t["id"], 0) > 0.2]
    if gen:
        top = max(gen, key=lambda t: t["tier"])
        base = f"Age of {top['name']}"
    else:
        base = "Neolithic Age"
        for tid, name in ERA_TECHS:
            if share.get(tid, 0) >= 0.2:
                if tid == "mars_colonization" and offworld < 1:
                    continue
                if tid == "interstellar_colonization" and not any(p["body"] in ("proxima", "tau_ceti", "trappist") and p["owner"] for p in state["provinces"].values()):
                    continue
                base = name
                break
    if dig > 0.3 * (dig + bio):
        base = "Post-Biological Age" if not gen else base + " (Post-Biological)"
    return base


def political_period(state: dict) -> str:
    tot = world_totals(state)
    blocs = {}
    for t in alive(state):
        c = state["countries"][t]
        if c.get("overlord"):
            continue
        b = bloc_of(state, t)
        blocs[t] = sum(state["countries"][x]["gdp"] for x in sorted(b)) / tot["gdp"]
    if not blocs:
        return "Dark Age"
    top = sorted(blocs.items(), key=lambda kv: -kv[1])
    lead, share = top[0]
    meta = state["meta"]
    if any(w.get("world_war") for w in state["wars"]):
        return next(w["name"] for w in state["wars"] if w.get("world_war"))
    recent = meta.get("last_great_collapse")
    if recent and meta["year"] - recent["year"] < 60:
        return f"Age of the Successor States (after {recent['name']})"
    if share >= 0.5:
        return f"Pax {state['countries'][lead]['adj']}"
    if len(top) > 1 and top[0][1] > 0.22 and top[1][1] > 0.18 and opinion(state, top[0][0], top[1][0]) < -20:
        return f"{state['countries'][top[0][0]]['adj']}-{state['countries'][top[1][0]]['adj']} Cold War"
    return "Multipolar Age"


def detect_phase(state: dict, tag: str) -> dict:
    c = state["countries"].get(tag)
    if not c or not c["alive"]:
        return {"id": "fallen", "label": "A fallen state", "metrics": {}}
    tot = world_totals(state)
    bloc = bloc_of(state, tag)
    provs = state["provinces"]
    earth_owned = [p for p in provs.values() if p["body"] == "earth" and p["owner"]]
    bloc_earth = [p for p in earth_owned if p["owner"] in bloc]
    gdp_share = sum(state["countries"][t]["gdp"] for t in sorted(bloc)) / tot["gdp"]
    prov_share = len(bloc_earth) / max(1, len(earth_owned))
    pop_share = sum(p["pop"] for p in bloc_earth) / max(1e-6, sum(p["pop"] for p in earth_owned))
    off = [p for p in provs.values() if p["owner"] in bloc and p["body"] != "earth"]
    exo = [p for p in off if p["body"] in ("proxima", "tau_ceti", "trappist")]
    dig = c["flags"].get("dig_share", 0)
    noncore = sum(1 for p in provs.values() if p["owner"] == tag and tag not in p["cores"]) / max(1, len(idx(state)["owned"].get(tag, [])))
    geo = get_geo()
    cont_share = 0.0
    cap = c["capital"]
    if cap in geo.provinces:
        cont = geo.continent.get(geo.provinces[cap]["country"])
        cont_p = [pid for pid, p in provs.items() if p["body"] == "earth" and p["owner"] and geo.continent.get(geo.provinces.get(pid, {}).get("country")) == cont]
        cont_share = sum(1 for pid in cont_p if provs[pid]["owner"] in bloc) / max(1, len(cont_p))
    m = {"gdp_share": round(gdp_share, 3), "prov_share": round(prov_share, 3), "pop_share": round(pop_share, 3), "offworld": len(off),
         "exo": len(exo), "dig_share": dig, "noncore": round(noncore, 2), "continent_share": round(cont_share, 2)}
    heritage = c.get("heritage") or []
    year = state["meta"]["year"]
    if dig > 0.5:
        pid, label = "post_biological", "A post-biological civilisation"
    elif exo:
        pid, label = "interstellar", "An interstellar civilisation"
    elif prov_share >= 0.6 or gdp_share >= 0.6:
        pid = "planetary_hegemon" if len(off) < 3 else "interplanetary_hegemon"
        label = "Master of the planet" if pid == "planetary_hegemon" else "Hegemon of an interplanetary civilisation"
    elif len(off) >= 3 or sum(p["pop"] for p in off) > 0.5:
        pid, label = "interplanetary", "An interplanetary power"
    elif cont_share >= 0.55 and noncore > 0.25:
        pid, label = "continental_empire", "A continental empire"
    elif heritage and c.get("founded") and year - c["founded"] < 80:
        pid, label = "successor_state", f"A successor of {heritage[-1]['name']}"
    elif gdp_share >= 0.06 or sorted((total_power(x) for x in state["countries"].values() if x["alive"]), reverse=True).index(total_power(c)) < 6:
        pid, label = "great_power", "A great power"
    elif gdp_share >= 0.03:
        pid, label = "regional_power", "A regional power"
    else:
        pid, label = "minor_state", "A minor state"
    return {"id": pid, "label": label, "metrics": m}


PHASE_TEXT = {
    "continental_empire": "The age of interstate rivalry on the continent is over: the question now is how to govern what has been conquered.",
    "planetary_hegemon": "There are no more rivals worthy of the name. History's challenges now come from within: administration, legitimacy, succession and the sheer scale of a planetary state.",
    "interplanetary_hegemon": "Humanity's single state now reaches beyond Earth; distance itself has become the main political problem.",
    "interplanetary": "The frontier has moved off-world. Colonies, supply lines and the loyalty of distant settlers now shape policy.",
    "post_biological": "Most citizens now live as digital minds. Questions of identity, rights and the purpose of the state have changed beyond recognition.",
    "interstellar": "Light-years separate the parts of the polity. Each colony is effectively a world unto itself.",
    "successor_state": "Born from the ruins of a fallen order, the state must build legitimacy, define its relation to the past and survive its rivals.",
    "great_power": "A great power with global interests and global rivals.",
    "regional_power": "A regional power balancing between greater neighbours.",
    "minor_state": "A small state whose survival depends on skill.",
    "fallen": "The state has fallen. History continues without it.",
}


def director_tick(state: dict, rng) -> None:
    meta = state["meta"]
    year = meta["year"]
    player = meta.get("player")
    era = world_era(state)
    if era != meta.get("era"):
        if meta.get("era"):
            emit(state, "era", f"A new era: the {era}", f"Historians will date the beginning of the {era} to {year}, as the transformations of the {meta['era']} gave way to a new world.",
                 [], 5, tags=["era"])
            state["milestones"].append({"y": year, "title": f"Beginning of the {era}", "actors": [], "kind": "era"})
        meta["era"] = era
        meta["era_since"] = year
    period = political_period(state)
    if period != meta.get("period"):
        if meta.get("period"):
            emit(state, "era", f"{period}", f"Contemporaries speak of a new political age: {period}. It follows the {meta['period']}.", [], 4, tags=["period"])
        meta["period"] = period
        meta["period_since"] = year
    if player:
        ph = detect_phase(state, player)
        old = meta.get("phase")
        meta["phase_metrics"] = ph["metrics"]
        if ph["id"] == old:
            meta["phase_cand"] = None
        else:
            if meta.get("phase_cand") != ph["id"]:
                meta["phase_cand"] = ph["id"]
                meta["phase_cand_since"] = year
            # a new phase must persist for two years before the story changes direction (except the fall of the state)
            if ph["id"] == "fallen" or year - meta.get("phase_cand_since", year) >= 2:
                meta["phase"] = ph["id"]
                meta["phase_label"] = ph["label"]
                meta["phase_since"] = year
                meta["phase_cand"] = None
                if old:
                    c = state["countries"].get(player)
                    emit(state, "chapter", f"A new chapter: {ph['label']}", f"{c['name'] if c else 'The state'} has entered a new phase of its history. {PHASE_TEXT.get(ph['id'], '')}",
                         [player], 5, tags=["chapter"], data={"from": old, "to": ph["id"]})
                    state["milestones"].append({"y": year, "title": f"{c['name'] if c else player}: {ph['label']}", "actors": [player], "kind": "chapter"})
    detect_threads(state, rng)
    escalate_threads(state, rng)
    anniversaries(state)
    hegemony_reactions(state, rng)
    random_events(state, rng)
    nuclear_check(state, rng)
    emergent_ideologies(state, rng)


def detect_threads(state: dict, rng) -> None:
    provs = state["provinces"]
    year = state["meta"]["year"]
    player = state["meta"].get("player")
    groups: dict[tuple, list[str]] = defaultdict(list)
    for pid, p in provs.items():
        if p["owner"] and p["owner"] not in p["cores"] and p["unrest"] > 35:
            key = (p["owner"], p["code"] if p["body"] == "earth" else p["body"])
            groups[key].append(pid)
    from ..sim.successors import region_label
    for (owner, code), pids in groups.items():
        c = state["countries"][owner]
        base, _ = region_label(state, pids)
        avg = sum(provs[p]["unrest"] for p in pids) / len(pids)
        key = f"resist:{owner}:{code}"
        th = find_thread(state, key)
        if not th:
            th = open_thread(state, "resistance", f"Resistance in {base}", f"The people of {base} resist {c['adj']} rule.", [owner], key=key, provinces=pids, tension=avg)
            if owner == player or avg > 55:
                emit(state, "unrest", th["title"], f"Resistance movements in {base} are organising against {c['name']}'s administration (unrest {avg:.0f}%).", [owner], 3, pids[:6], ["unrest"], th["id"])
        th["tension"] = round(avg, 1)
        th["provinces"] = pids
    for th in active_threads(state):
        if th["kind"] == "resistance":
            owner, code = th["key"].split(":")[1:3]
            ps = [p for p in th["provinces"] if provs.get(p, {}).get("owner") == owner]
            if not ps or sum(provs[p]["unrest"] for p in ps) / len(ps) < 20:
                close_thread(state, th["id"], "The resistance faded as the region was integrated." if ps else "The region left the state.")
    # colonial tension: Earth vs off-world settlements
    for t in alive(state):
        c = state["countries"][t]
        colonies = [pid for pid in idx(state)["owned"].get(t, []) if provs[pid]["body"] != c["home"]]
        bodies = defaultdict(list)
        for pid in colonies:
            bodies[provs[pid]["body"]].append(pid)
        for body, ps in bodies.items():
            pop = sum(provs[p]["pop"] for p in ps)
            desire = max(provs[p].get("autonomy_desire", 0) for p in ps)
            key = f"colony:{t}:{body}"
            th = find_thread(state, key)
            bname = state["bodies"].get(body, {}).get("name", body)
            if desire > 30 and pop > 0.02 and not th:
                th = open_thread(state, "colonial_tension", f"{c['adj'] if c['home'] == 'earth' else c['name']}-{bname.split(' (')[0]} tensions",
                                 f"Settlers on {bname} increasingly see themselves as a distinct people with interests opposed to {c['name']}'s home government.",
                                 [t], key=key, provinces=ps, tension=desire, data={"body": body})
                emit(state, "space", th["title"], th["summary"], [t], 4 if t == player else 3, ps[:4], ["space", "colonial"], th["id"])
            if th:
                th["tension"] = round(desire, 1)
                th["provinces"] = ps
                if desire < 15:
                    close_thread(state, th["id"], "Colonial grievances were addressed.")
        for th in active_threads(state, t):
            if th["kind"] == "colonial_tension" and th["data"].get("body") not in bodies:
                close_thread(state, th["id"], "The colonies left the state.")
        # digital / AI rights
        for kind, flag, label in (("digital_rights", "digital_tension", "Rights of the Uploaded"), ("ai_rights", "ai_tension", "Artificial Personhood")):
            v = c["flags"].get(flag, 0)
            key = f"{kind}:{t}"
            th = find_thread(state, key)
            if v > 6 and not th:
                th = open_thread(state, kind, f"{label} in {c['name']}", f"A movement demands full legal personhood for {'uploaded minds' if kind == 'digital_rights' else 'artificial intelligences'} in {c['name']}.", [t], key=key, tension=v)
                emit(state, "society", th["title"], th["summary"], [t], 4 if t == player else 3, tags=["society", kind], thread=th["id"])
            if th:
                th["tension"] = v
                if v < 2:
                    close_thread(state, th["id"], "Legal reforms resolved the question for now.")
        # imperial overstretch
        if t == player:
            mine = idx(state)["owned"].get(t, [])
            noncore = sum(1 for p in mine if t not in provs[p]["cores"]) / max(1, len(mine))
            key = f"overstretch:{t}"
            th = find_thread(state, key)
            if noncore > 0.45 and c["stability"] < 55 and len(mine) > 30 and not th:
                th = open_thread(state, "overstretch", "Imperial Overstretch", f"{c['name']} governs far more territory than its institutions were built for; administrators, garrisons and revenue are spread thin.", [t], key=key, tension=100 - c["stability"])
                emit(state, "politics", "Imperial overstretch", th["summary"], [t], 4, tags=["empire"], thread=th["id"])
            if th:
                th["tension"] = round(100 - c["stability"], 1)
                if noncore < 0.3 or c["stability"] > 70:
                    close_thread(state, th["id"], "The empire's institutions caught up with its size.")
            # rival superpower
            me = total_power(c)
            for o in alive(state):
                if o == t or state["countries"][o].get("overlord"):
                    continue
                oc = state["countries"][o]
                key = f"rival:{t}:{o}"
                th = find_thread(state, key)
                if total_power(oc) > 0.55 * me and opinion(state, o, t) < -15 and total_power(oc) > 2:
                    if not th:
                        th = open_thread(state, "rivalry", f"Rivalry with {oc['name']}", f"{oc['name']} has emerged as the principal rival of {c['name']}.", [t, o], key=key, tension=50)
                        emit(state, "politics", th["title"], th["summary"], [t, o], 3, tags=["rivalry"], thread=th["id"])
                    th["tension"] = round(clamp(50 + (total_power(oc) / max(0.1, me) - 0.5) * 60 - opinion(state, o, t) / 4, 0, 100), 1)
                elif th:
                    close_thread(state, th["id"], f"{oc['name']} ceased to be a serious rival.")
            for th in active_threads(state, t):
                if th["kind"] == "rivalry" and not state["countries"].get(th["actors"][1], {}).get("alive"):
                    close_thread(state, th["id"], "The rival state no longer exists.")
            # economic crisis
            prev = c.get("prev_gdp", c["gdp"])
            key = f"econ:{t}"
            th = find_thread(state, key)
            if prev and c["gdp"] < prev * 0.95 and not th:
                th = open_thread(state, "economic_crisis", f"Economic crisis in {c['name']}", f"Output fell {100 * (1 - c['gdp'] / prev):.0f}% in a year.", [t], key=key, tension=60)
                emit(state, "economy", th["title"], th["summary"], [t], 3, tags=["economy"], thread=th["id"])
            elif th and c["gdp"] > prev * 1.01:
                close_thread(state, th["id"], "The economy recovered.")
    # restoration movements for fallen states
    for t, c in state["countries"].items():
        if c["alive"] or not c.get("fell") or year - c["fell"] > 300:
            continue
        ps = [pid for pid, p in provs.items() if t in p["cores"] and p["owner"] and p["owner"] != t]
        if len(ps) < 2:
            continue
        avg = sum(provs[p]["unrest"] for p in ps) / len(ps)
        key = f"restore:{t}"
        th = find_thread(state, key)
        if avg > 40 and not th:
            th = open_thread(state, "restoration", f"Movement to restore {c['name']}", f"{year - c['fell']} years after its fall, nostalgia for {c['name']} fuels a restoration movement.", [t] + sorted({provs[p]['owner'] for p in ps}), key=key, provinces=ps, tension=avg)
            emit(state, "politics", th["title"], th["summary"], th["actors"], 3, ps[:5], ["restoration"], th["id"])
        if th:
            th["tension"] = round(avg, 1)
            if avg < 20:
                close_thread(state, th["id"], "The restoration movement lost momentum.")


def escalate_threads(state: dict, rng) -> None:
    from .decisions import add_decision
    player = state["meta"].get("player")
    provs = state["provinces"]
    for th in active_threads(state):
        if th["kind"] == "colonial_tension" and th["tension"] > 65 and not th["data"].get("demanded"):
            t = th["actors"][0]
            c = state["countries"][t]
            body = th["data"]["body"]
            bname = state["bodies"].get(body, {}).get("name", body).split(" (")[0]
            th["data"]["demanded"] = state["meta"]["year"]
            emit(state, "space", f"The {bname} Congress demands self-rule", f"Delegates from the settlements of {bname} have convened a congress demanding representation and autonomy from {c['name']}.", [t], 4, th["provinces"][:4], ["space", "colonial"], th["id"])
            if t == player:
                add_decision(state, "hook", f"The {bname} Question", f"The settlers of {bname} demand self-government. How will {c['name']} answer?",
                             [("autonomy", "Grant home rule", f"A {bname} legislature with control of internal affairs.", [{"type": "set_policy", "policy": "colonial", "value": "autonomy"}]),
                              ("represent", "Seats in the national legislature", "Integrate the colonists as full citizens.", [{"type": "set_policy", "policy": "colonial", "value": "representation"}, {"type": "national_initiative", "name": f"{bname} Representation Act", "effects": {"stability": 2}, "years": 1, "cost_share": 0.001}]),
                              ("independence", f"Grant {bname} independence", "Let the colonies become a sovereign state.", [{"type": "grant_independence", "provinces": th["provinces"]}]),
                              ("repress", "Dissolve the congress", "Order is restored by force. Resentment will grow.", [{"type": "set_policy", "policy": "integration", "value": "suppress"}])],
                             owner=t, deadline_years=2)
            elif c["policies"].get("colonial") != "autonomy" and rng.random() < 0.5:
                from ..sim.successors import create_country
                ps = [p for p in th["provinces"] if provs[p]["owner"] == t]
                if ps:
                    new = create_country(state, ps, parent=t, kind="independence", rng=rng, origin=f"Founded by the {bname} Congress in {state['meta']['year']}.")
                    emit(state, "space", f"{state['countries'][new]['name']} declares independence", f"The settlements of {bname} have declared independence from {c['name']}.", [new, t], 5, ps[:4], ["space", "independence"], th["id"])
                    state["milestones"].append({"y": state["meta"]["year"], "title": f"Independence of {state['countries'][new]['name']}", "actors": [new, t], "kind": "independence"})
                    close_thread(state, th["id"], f"{bname} became independent as {state['countries'][new]['name']}.")
        if th["kind"] in ("digital_rights", "ai_rights") and th["tension"] > 25 and not th["data"].get("escalated"):
            t = th["actors"][0]
            th["data"]["escalated"] = state["meta"]["year"]
            c = state["countries"][t]
            subj = "uploaded minds" if th["kind"] == "digital_rights" else "artificial intelligences"
            emit(state, "society", f"{subj.capitalize()} go on strike in {c['name']}", f"Denied legal personhood, {subj} have withdrawn their labour from the networks of {c['name']}. Output falls and the government faces a constitutional crisis.", [t], 4, tags=["society"], thread=th["id"])
            c.setdefault("temp_mods", []).append({"until": state["meta"]["year"] + 3, "stability": -10})
            if t == player:
                pol = "digital_rights" if th["kind"] == "digital_rights" else "ai_rights"
                add_decision(state, "hook", f"The {subj} crisis", f"How will {c['name']} answer the demands of its {subj}?",
                             [("equal", "Grant equal citizenship", "Full legal personhood and the vote.", [{"type": "set_policy", "policy": pol, "value": "equal"}]),
                              ("limited", "Grant limited rights", "Protection from deletion and coercion, but no vote.", [{"type": "set_policy", "policy": pol, "value": "limited"}]),
                              ("deny", "Deny their claims", "Order the networks restored.", [{"type": "set_policy", "policy": pol, "value": "none"}])], owner=t)


def anniversaries(state: dict) -> None:
    year = state["meta"]["year"]
    if state["meta"]["month"] != 1 and state["meta"].get("dt", 1) < 1:
        return
    seen = state["meta"].setdefault("anniv_done", [])
    for ms in state["milestones"]:
        age = year - ms["y"]
        if age in (50, 100, 250, 500, 1000, 2000, 5000) and f"{ms['title']}:{age}" not in seen:
            seen.append(f"{ms['title']}:{age}")
            heirs = []
            for a in ms.get("actors", []):
                if state["countries"].get(a, {}).get("alive"):
                    heirs.append(a)
                else:
                    heirs += [t for t, c in state["countries"].items() if c["alive"] and any(h.get("tag") == a for h in c.get("heritage", []))]
            heirs = list(dict.fromkeys(heirs))[:4]
            who = ", ".join(state["countries"][h]["name"] for h in heirs) if heirs else "historians across the world"
            emit(state, "anniversary", f"{ordinal(age)} anniversary: {ms['title']}", f"{year} marks {age} years since {ms['title']} ({ms['y']}). Commemorations are held by {who}.",
                 heirs, 3 if age >= 100 else 2, tags=["anniversary"], data={"milestone": ms["title"], "age": age})
    if len(seen) > 2000:
        del seen[:1000]


def hegemony_reactions(state: dict, rng) -> None:
    tot = world_totals(state)
    year = state["meta"]["year"]
    for t in alive(state):
        c = state["countries"][t]
        if c.get("overlord"):
            continue
        bloc = bloc_of(state, t)
        share = sum(state["countries"][x]["gdp"] for x in sorted(bloc)) / tot["gdp"]
        recent_conquests = sum(1 for e in state.get("ownership_log", [])[-400:] if e[3] == t and e[4] == "conquest" and year - e[0] < 15)
        oid = f"coalition_{t}"
        if 0.3 < share < 0.75 and recent_conquests >= 6 and oid not in state["orgs"]:
            members = [o for o in alive(state) if o not in bloc and opinion(state, o, t) < -10 and total_power(state["countries"][o]) > 0.5 and o != state["meta"].get("player")]
            if len(members) >= 2:
                state["orgs"][oid] = {"id": oid, "name": f"Grand Coalition against {c['name']}", "kind": "coalition", "founded": year,
                                      "members": members[:12], "desc": f"States united by fear of {c['name']}'s expansion.", "leader": members[0], "target": t}
                emit(state, "diplomacy", f"Grand Coalition forms against {c['name']}", f"Alarmed by {c['name']}'s conquests, {len(members[:12])} states have pledged to stand together against further aggression.", [t] + members[:6], 4, tags=["coalition"])
        if oid in state["orgs"] and (share < 0.2 or not c["alive"]):
            del state["orgs"][oid]
    # institutions after a great collapse
    gc = state["meta"].get("last_great_collapse")
    if gc and not gc.get("institution") and year - gc["year"] >= 3:
        succ = [x for x in gc.get("successors", []) if state["countries"].get(x, {}).get("alive")]
        if len(succ) >= 3:
            oid = f"concord_{gc['tag']}"
            name = f"Concord of the {gc['adj']} Successor States"
            state["orgs"][oid] = {"id": oid, "name": name, "kind": "international", "founded": year, "members": succ,
                                  "desc": f"Founded to keep the peace among the states that emerged from {gc['name']}.", "leader": None}
            gc["institution"] = oid
            emit(state, "diplomacy", f"Founding of the {name}", f"Meeting in the former imperial capital, representatives of {len(succ)} successor states of {gc['name']} established a permanent council to settle disputes and preserve trade.", succ[:8], 4, tags=["institution"])


EVENT_POOL = [
    ("boom", "Economic boom in {c}", "A surge of investment and trade lifts the economy of {c}.", 2.0),
    ("recession", "Recession in {c}", "A financial panic tips {c} into recession.", 2.0),
    ("discovery", "Scientific breakthrough in {c}", "Researchers in {c} announce a discovery that accelerates national research.", 1.5),
    ("disaster", "Disaster strikes {p}", "A catastrophic {d} devastates {p} in {c}.", 1.2),
    ("scandal", "Scandal shakes the government of {c}", "Revelations of corruption at the highest levels of {c} spark public outrage.", 1.5),
    ("movement", "Cultural movement sweeps {c}", "A new artistic and intellectual movement captures the imagination of {c}.", 1.0),
    ("strike", "General strike in {c}", "Workers across {c} walk out demanding better conditions.", 1.0),
    ("assassination", "Assassination attempt on {l}", "{l} of {c} survived an assassination attempt.", 0.6),
    ("pandemic", "Epidemic in {c}", "A deadly epidemic spreads through {c}.", 0.5),
]
DISASTERS = ["earthquake", "flood", "drought", "cyclone", "volcanic eruption", "famine"]


def random_events(state: dict, rng) -> None:
    from ..sim.core import add_memory
    tags = alive(state)
    if not tags:
        return
    player = state["meta"].get("player")
    n = 2 + (1 if rng.random() < 0.5 else 0)
    weights = [min(1e6, max(0.5, state["countries"][t]["gdp"])) ** 0.5 for t in tags]
    for _ in range(n):
        t = rng.choices(tags, weights=weights)[0]
        if rng.random() < 0.25 and player in tags:
            t = player
        c = state["countries"][t]
        kind, title, body, _w = rng.choices(EVENT_POOL, weights=[e[3] for e in EVENT_POOL])[0]
        mine = idx(state)["owned"].get(t, [])
        if not mine:
            continue
        pid = rng.choice(mine)
        from ..sim.war import _pname
        d = rng.choice(DISASTERS)
        fmt = dict(c=c["name"], p=_pname(state, pid), l=c["leader"]["name"], d=d)
        eff_txt = ""
        if kind == "boom":
            c.setdefault("temp_mods", []).append({"until": state["meta"]["year"] + 2, "stability": 4})
            c["treasury"] += c["gdp"] * 0.01
        elif kind == "recession":
            c.setdefault("temp_mods", []).append({"until": state["meta"]["year"] + 2, "stability": -5})
            for p in mine:
                state["provinces"][p]["gpc"] *= 0.97
        elif kind == "discovery":
            c["research"]["progress"] = c["research"].get("progress", 0) + c.get("rp_rate", 0) * 0.5
        elif kind == "disaster":
            state["provinces"][pid]["pop"] *= 0.985 if d != "famine" else 0.96
            state["provinces"][pid]["dev"] = max(0.5, state["provinces"][pid]["dev"] - 0.05)
        elif kind == "scandal":
            c["legitimacy"] = clamp(c["legitimacy"] - 8, 0, 100)
        elif kind == "movement":
            stab_add(c, 2)
        elif kind == "strike":
            stab_add(c, -3)
        elif kind == "pandemic":
            mult = 0.97 if "antibiotics" in c["techs"] else 0.93
            if "gene_therapy" in c["techs"]:
                mult = 0.995
            for p in mine:
                state["provinces"][p]["pop"] *= mult
        imp = 3 if t == player else 2
        emit(state, kind, title.format(**fmt), body.format(**fmt) + eff_txt, [t], imp, [pid] if kind == "disaster" else [], ["flavor", kind])


def nuclear_check(state: dict, rng) -> None:
    for w in state["wars"]:
        nuc_a = [t for t in w["att"] if state["countries"][t].get("nukes", 0) > 50]
        nuc_d = [t for t in w["def"] if state["countries"][t].get("nukes", 0) > 50]
        if not nuc_a or not nuc_d:
            continue
        desperate = [t for t in nuc_a + nuc_d if w["exh"].get(t, 0) > 70 and state["countries"][t]["leader"]["traits"]["agg"] > 0.6
                     and t != state["meta"].get("player")]
        if desperate and rng.random() < 0.08:
            t = desperate[0]
            enemies = w["def"] if t in w["att"] else w["att"]
            for side in (w["att"], w["def"]):
                for x in side:
                    c = state["countries"][x]
                    for pid in idx(state)["owned"].get(x, []):
                        state["provinces"][pid]["pop"] *= 0.82
                        state["provinces"][pid]["dev"] = max(0.5, state["provinces"][pid]["dev"] - 0.3)
                    c["stability"] = max(0.0, c["stability"] - 35)
                    c["nukes"] = int(c["nukes"] * 0.3)
            for c in state["countries"].values():
                if c["alive"]:
                    c.setdefault("temp_mods", []).append({"until": state["meta"]["year"] + 5, "stability": -8})
            emit(state, "catastrophe", "Nuclear exchange", f"Facing defeat, {state['countries'][t]['name']} launched its nuclear arsenal. {', '.join(state['countries'][e]['name'] for e in enemies[:3])} retaliated. Cities burn across the belligerent nations; fallout and a nuclear winter threaten the whole world.",
                 w["att"] + w["def"], 5, tags=["nuclear", "catastrophe"])
            state["milestones"].append({"y": state["meta"]["year"], "title": f"Nuclear exchange in the {w['name']}", "actors": w["att"] + w["def"], "kind": "catastrophe"})


def emergent_ideologies(state: dict, rng) -> None:
    """New doctrines emerge from actual conditions: colonial identity, post-biological life, hegemony."""
    year = state["meta"]["year"]
    done = state["meta"].setdefault("emergent", [])
    for t in alive(state):
        c = state["countries"][t]
        if c["home"] in ("mars", "luna", "belt") and f"home:{c['home']}" not in done and year - (c.get("founded") or year) > 5:
            done.append(f"home:{c['home']}")
            nm = {"mars": "Martian Autonomism", "luna": "Selenite Republicanism", "belt": "Belter Mutualism"}[c["home"]]
            ide = invent_ideology(state, {"econ": 0.1, "auth": -0.2, "prog": 0.7, "central": -0.6, "substrate": 0.3},
                                  f"the independence struggle of {c['name']}", t, year, name=nm,
                                  desc=f"The conviction that the settlers of {state['bodies'][c['home']]['name']} form a sovereign people whose survival depends on self-government, not on decisions taken on Earth.")
            emit(state, "ideology", f"The rise of {nm}", f"{ide['desc']} It began in {c['name']}.", [t], 3, tags=["ideology"])
        if c["flags"].get("dig_share", 0) > 0.3 and "post_bio" not in done:
            done.append("post_bio")
            ide = invent_ideology(state, {"econ": -0.3, "auth": 0.1, "prog": 1.0, "central": 0.4, "substrate": 1.0},
                                  f"the digital majority of {c['name']}", t, year, name="Continuity Doctrine",
                                  desc="The belief that a person is a pattern, not a body, and that the state's first duty is the preservation and flourishing of minds on any substrate.")
            emit(state, "ideology", "The Continuity Doctrine", f"Among the uploaded citizens of {c['name']}, a new political philosophy has emerged: {ide['desc']}", [t], 4, tags=["ideology"])
