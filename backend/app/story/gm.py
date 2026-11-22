"""Game-master mode: Claude narrates the world from whatever the player writes and proposes concrete changes;
this module builds the context it reads and validates/applies the changes it proposes to the simulation."""
from __future__ import annotations

import json
import re

from ..memory.store import query_events
from ..sim.core import add_memory, alive, allies, at_war, build_index, emit, idx, stab_add, total_power, wars_of
from ..sim.relations import modify, neighbors_of, opinion, trust
from ..util import clamp, fmt_money, fmt_pop, rng_for
from ..world.geo import get_geo
from ..world.ideologies import get_ideology, invent_ideology
from ..world.techtree import all_techs

MAX_CHANGES = 10


# ---------------------------------------------------------------- name resolution

def resolve_country(state: dict, name) -> str | None:
    if not name:
        return None
    s = str(name).strip()
    if s in state["countries"] and state["countries"][s]["alive"]:
        return s
    low = s.lower()
    for t, c in state["countries"].items():
        if c["alive"] and (c["name"].lower() == low or c["adj"].lower() == low):
            return t
    from ..orders.parser import find_countries
    found = find_countries(state, s)
    return found[0] if found else None


def _norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+region$", "", s).strip()


def _fuzzy_region(state: dict, name: str, owner: str | None) -> list[str]:
    import difflib
    pool = idx(state)["owned"].get(owner, []) if owner else list(state["provinces"])
    names = {}
    for pid in pool:
        names.setdefault(_norm(_pname(state, pid)), []).append(pid)
    q = _norm(name)
    if q in names:
        return names[q]
    hit = difflib.get_close_matches(q, list(names), n=1, cutoff=0.6)
    return names[hit[0]] if hit else []


def resolve_regions(state: dict, names, owner: str | None = None) -> list[str]:
    from ..orders.parser import find_provinces
    out: list[str] = []
    for n in names or []:
        n = str(n)
        if n in state["provinces"]:
            ps = [n]
        else:
            ps = _fuzzy_region(state, n, owner) if owner else []
            if not ps:
                ps = find_provinces(state, n, owner_filter={owner} if owner else None)
            if not ps and owner:
                oc = resolve_country(state, n)
                if oc == owner:
                    ps = list(idx(state)["owned"].get(owner, []))
        for p in ps:
            if p not in out and (owner is None or state["provinces"][p]["owner"] == owner):
                out.append(p)
    return out[:120]


def _pname(state, pid):
    from ..sim.war import _pname
    return _pname(state, pid)


# ---------------------------------------------------------------- context

def nation_line(state: dict, t: str, player: str | None) -> str:
    c = state["countries"][t]
    ide = get_ideology(state, c["ideology"])
    bits = [f"{c['name']} — {c['gov']}, {ide['name']}; {c['leader']['title']} {c['leader']['name']}; GDP {fmt_money(c['gdp'])}; pop {fmt_pop(c['pop'])}; stability {c['stability']:.0f}%"]
    if c.get("overlord"):
        bits.append(f"subject of {state['countries'][c['overlord']]['name']}")
    if player and t != player:
        bits.append(f"opinion of player {opinion(state, t, player):+.0f}")
    return "; ".join(bits)


def story_context(state: dict, cid: str) -> dict:
    m = state["meta"]
    p = m.get("player")
    c = state["countries"].get(p)
    ranked = sorted(alive(state), key=lambda t: -total_power(state["countries"][t]))
    near = sorted(neighbors_of(state, p)) if c else []
    focus = list(dict.fromkeys(ranked[:28] + near))[:45]
    lines = []
    lines.append(f"DATE: {m['month']:02d}/{m['year']} ({m['year'] - m['start_year']} years after the campaign began in {m['start_year']}). ERA: {m.get('era')}. POLITICAL AGE: {m.get('period')}.")
    if c and c["alive"]:
        at = all_techs(state)
        lines.append("PLAYER NATION: " + nation_line(state, p, None))
        lines.append(f"  Territory: {len(idx(state)['owned'].get(p, []))} provinces, e.g. {', '.join(_pname(state, x) for x in idx(state)['owned'].get(p, [])[:12])}")
        lines.append(f"  Army {c['army']:,.0f}k, navy {c['navy']:,.0f}, air {c['air']:,.0f}, nukes {c.get('nukes', 0)}; treasury {fmt_money(c['treasury'])}, debt {fmt_money(c['debt'])}")
        lines.append(f"  Latest technology: {', '.join(at[x]['name'] for x in sorted(c['techs'], key=lambda x: -at.get(x, {}).get('tier', 0))[:6] if x in at)}")
        lines.append(f"  Allies: {', '.join(state['countries'][a]['name'] for a in sorted(allies(state, p))) or 'none'}; neighbours: {', '.join(state['countries'][n]['name'] for n in near[:15])}")
        mem = sorted(c["memories"], key=lambda x: -abs(x["w"]))[:5]
        if mem:
            lines.append("  National memory: " + " | ".join(f"{x['y']}: {x['text']}" for x in mem))
    else:
        lines.append("PLAYER NATION: fallen.")
    lines.append("NATIONS (name — government; leader; GDP; population; stability; opinion of player):")
    for t in focus:
        lines.append("  - " + nation_line(state, t, p))
    others = [state["countries"][t]["name"] for t in ranked[len(focus):][:80] if t not in focus]
    if others:
        lines.append("  Other states: " + ", ".join(others))
    if state["wars"]:
        lines.append("WARS: " + "; ".join(f"{w['name']} ({', '.join(state['countries'][x]['name'] for x in w['att'][:4])} vs {', '.join(state['countries'][x]['name'] for x in w['def'][:4])}, since {w['start']}, attacker war score {w['score']:+.0f})" for w in state["wars"][:10]))
    rel = [p] if c else []
    rel += near + [x for w in (wars_of(state, p) if c else []) for x in w["att"] + w["def"]] + ranked[:8]
    lines.append("REGIONS BY NATION (use these exact region names in changes):")
    for t in list(dict.fromkeys(x for x in rel if x in state["countries"] and state["countries"][x]["alive"]))[:24]:
        own = idx(state)["owned"].get(t, [])
        lines.append(f"  {state['countries'][t]['name']}: " + ", ".join(_pname(state, x) for x in own[:40]) + (f" (+{len(own) - 40} more)" if len(own) > 40 else ""))
    orgs = [o for o in state["orgs"].values() if len(o["members"]) >= 2][:10]
    if orgs:
        lines.append("ORGANISATIONS: " + "; ".join(f"{o['name']} ({o['kind']}, {len(o['members'])} members)" for o in orgs))
    stories = query_events(cid, kinds=["story"], limit=3)
    if stories:
        lines.append("PREVIOUS CHAPTERS (most recent first):")
        for e in stories:
            lines.append(f"  [{e['month']:02d}/{e['year']}] {e['title']}: {e['body'][:900]}")
    evs = [e for e in query_events(cid, min_importance=3, limit=40) if e["kind"] not in ("story", "mission", "decision", "decision_made")][:22]
    if evs:
        lines.append("RECENT EVENTS: " + " | ".join(f"{e['year']}: {e['title']}" for e in evs))
    return {"text": "\n".join(lines), "player": c["name"] if c else None, "leader": c["leader"]["name"] if c else None,
            "date": f"{m['month']:02d}/{m['year']}", "year": m["year"]}


CHANGE_SPEC = """Allowed "changes" (use country NAMES exactly as listed in NATIONS / Other states; regions can be modern country names like "Poland" or region names like "Bavaria"/"Silesian"):
- {"op":"war","attacker":A,"defender":B}
- {"op":"peace","a":A,"b":B,"winner":A or B or null,"regions_ceded":[...]}   (regions the loser gives the winner)
- {"op":"treaty","a":A,"b":B,"type":"alliance|defensive_pact|non_aggression|trade"}
- {"op":"break_treaty","a":A,"b":B}
- {"op":"territory","from":A,"to":B,"regions":[...]}
- {"op":"new_country","name":"...","from":A,"regions":[...],"ideology":"short ideology name","leader":"...","title":"..."}
- {"op":"annex","country":A,"target":B}
- {"op":"subject","overlord":A,"subject":B}
- {"op":"independence","subject":A}
- {"op":"government","country":A,"form":"e.g. Absolute Monarchy","ideology":"name of new or existing ideology","ideology_description":"...","leader":"...","title":"..."}
- {"op":"leader","country":A,"name":"...","title":"..."}
- {"op":"rename","country":A,"name":"..."}
- {"op":"stats","country":A,"stability":-30..30,"legitimacy":-30..30,"economy_pct":-25..25,"army_pct":-60..60,"treasury_pct_gdp":-20..20}
- {"op":"relations","a":A,"b":B,"change":-40..40,"memory":"what A will remember about B"}
- {"op":"research","country":A,"technology":"exact technology name"}
- {"op":"organization","name":"...","kind":"alliance|federation|economic|international|religious","members":[...]}
- {"op":"colonize","country":A,"world":"Moon|Mars|..."}
Only propose changes that the narrative actually describes. Max 10."""


def chat_context(state: dict, cid: str, members: list[str]) -> str:
    p = state["meta"]["player"]
    pc = state["countries"][p]
    lines = [f"DATE: {state['meta']['month']:02d}/{state['meta']['year']}. ERA: {state['meta'].get('era')}.",
             f"THE PLAYER: {pc['leader']['title']} {pc['leader']['name']} of {pc['name']} ({pc['gov']}, {get_ideology(state, pc['ideology'])['name']})."]
    lines.append("LEADERS IN THIS CHAT:")
    for t in members:
        c = state["countries"].get(t)
        if not c or not c["alive"]:
            continue
        tr = c["leader"]["traits"]
        mem = sorted([x for x in c["memories"] if x["other"] == p], key=lambda x: -abs(x["w"]))[:3]
        rel = []
        for o in members:
            if o != t and state["countries"].get(o, {}).get("alive"):
                rel.append(f"{state['countries'][o]['name']} {opinion(state, t, o):+.0f}")
        lines.append(f"- {c['leader']['name']}, {c['leader']['title']} of {c['name']} ({c['gov']}, {get_ideology(state, c['ideology'])['name']}). "
                     f"Personality: aggression {tr['agg']:.1f}, caution {tr['cau']:.1f}, honour {tr['hon']:.1f}, ambition {tr['amb']:.1f}. "
                     f"Opinion of the player {opinion(state, t, p):+.0f}, trust {trust(state, t, p):.0f}. Views of others: {', '.join(rel) or '-'}. "
                     f"At war with: {', '.join(state['countries'][x]['name'] for w in wars_of(state, t) for x in (w['def'] if t in w['att'] else w['att']))[:200] or 'nobody'}. "
                     + (f"Remembers about the player: {' | '.join(f'{x['y']}: {x['text']}' for x in mem)}" if mem else ""))
    return "\n".join(lines)


# ---------------------------------------------------------------- applying changes

def apply_changes(state: dict, changes: list, rng, source: str = "story", allowed: set[str] | None = None) -> tuple[list[str], list[str]]:
    from ..orders.executor import execute_actions
    from ..sim.war import apply_peace, end_war, start_war, transfer_province
    done, rejected = [], []
    player = state["meta"].get("player")
    year = state["meta"]["year"]

    def R(x):
        return resolve_country(state, x)

    def ok_party(*tags):
        return allowed is None or all(t in allowed for t in tags if t)

    for ch in (changes or [])[:MAX_CHANGES]:
        if not isinstance(ch, dict):
            continue
        op = str(ch.get("op", "")).lower()
        try:
            if op == "war":
                a, b = R(ch.get("attacker")), R(ch.get("defender"))
                if not a or not b or a == b or not ok_party(a, b):
                    raise ValueError("unknown countries")
                if at_war(state, a, b):
                    raise ValueError("already at war")
                w = start_war(state, a, b, "conquest")
                done.append(f"{state['countries'][a]['name']} declared war on {state['countries'][b]['name']}")
            elif op == "peace":
                a, b = R(ch.get("a")), R(ch.get("b"))
                w = next((w for w in state["wars"] if (a in w["att"] and b in w["def"]) or (a in w["def"] and b in w["att"])), None)
                if not w:
                    raise ValueError("no such war")
                win = R(ch.get("winner"))
                ceded = []
                if win in (a, b):
                    loser = b if win == a else a
                    ceded = resolve_regions(state, ch.get("regions_ceded") or [], loser)
                    for pid in ceded:
                        transfer_province(state, pid, win, "conquest")
                    build_index(state)
                end_war(state, w, "none", f"Peace was concluded between {state['countries'][a]['name']} and {state['countries'][b]['name']}.")
                done.append(f"Peace between {state['countries'][a]['name']} and {state['countries'][b]['name']}" + (f"; {len(ceded)} region(s) ceded" if ceded else ""))
            elif op == "treaty":
                a, b = R(ch.get("a")), R(ch.get("b"))
                typ = ch.get("type", "alliance")
                if not a or not b or a == b or typ not in ("alliance", "defensive_pact", "non_aggression", "trade") or not ok_party(a, b):
                    raise ValueError("invalid treaty")
                from ..world.scenario import next_id
                state["treaties"].append({"id": next_id(state, "t"), "type": typ, "members": [a, b], "since": year,
                                          "name": ch.get("name") or f"{state['countries'][a]['adj']}-{state['countries'][b]['adj']} {typ.replace('_', ' ').title()}", "secret": bool(ch.get("secret"))})
                add_memory(state, a, b, "treaty", 15, f"Signed a {typ.replace('_', ' ')} with {state['countries'][b]['name']} in {year}.")
                add_memory(state, b, a, "treaty", 15, f"Signed a {typ.replace('_', ' ')} with {state['countries'][a]['name']} in {year}.")
                done.append(f"{typ.replace('_', ' ').title()}: {state['countries'][a]['name']} & {state['countries'][b]['name']}")
            elif op == "break_treaty":
                a, b = R(ch.get("a")), R(ch.get("b"))
                n = 0
                for t in list(state["treaties"]):
                    if a in t["members"] and b in t["members"]:
                        state["treaties"].remove(t)
                        n += 1
                if n:
                    add_memory(state, b, a, "betrayal", -25, f"{state['countries'][a]['name']} broke its treaty in {year}.")
                done.append(f"{n} treaty(ies) broken")
            elif op == "territory":
                a, b = R(ch.get("from")), R(ch.get("to"))
                if not a or not b or a == b or not ok_party(a, b):
                    raise ValueError("unknown countries")
                ps = resolve_regions(state, ch.get("regions"), a)
                if not ps:
                    raise ValueError("no matching regions owned by " + state["countries"][a]["name"])
                if len(ps) >= len(idx(state)["owned"].get(a, [])):
                    ps = ps[:-1] or ps
                for pid in ps:
                    transfer_province(state, pid, b, "conquest" if at_war(state, a, b) else "peaceful")
                build_index(state)
                add_memory(state, a, b, "territory_lost", -30, f"Lost {', '.join(_pname(state, x) for x in ps[:3])} to {state['countries'][b]['name']} in {year}.")
                done.append(f"{len(ps)} region(s) passed from {state['countries'][a]['name']} to {state['countries'][b]['name']}")
            elif op == "new_country":
                parent = R(ch.get("from"))
                if not parent:
                    raise ValueError("unknown parent")
                ps = resolve_regions(state, ch.get("regions"), parent)
                if not ps:
                    raise ValueError("no regions")
                if len(ps) >= len(idx(state)["owned"].get(parent, [])):
                    ps = ps[:-1]
                if not ps:
                    raise ValueError("cannot take every region")
                from ..sim.successors import create_country
                ide = None
                if ch.get("ideology"):
                    ide = _ideology(state, str(ch["ideology"]), str(ch.get("ideology_description") or ""), parent)
                name = str(ch.get("name") or "")[:60] or None
                tag = create_country(state, ps, parent=parent, kind="independence", name=name, ideology=ide, rng=rng,
                                     origin=str(ch.get("origin") or f"Proclaimed in {year} out of {state['countries'][parent]['name']}.")[:400])
                nc = state["countries"][tag]
                if ch.get("leader"):
                    nc["leader"]["name"] = str(ch["leader"])[:60]
                if ch.get("title"):
                    nc["leader"]["title"] = str(ch["title"])[:40]
                done.append(f"New state: {nc['name']} ({len(ps)} regions)")
            elif op == "annex":
                a, b = R(ch.get("country")), R(ch.get("target"))
                if not a or not b or a == b or not ok_party(a, b):
                    raise ValueError("unknown countries")
                res = execute_actions(state, a, [{"type": "annex_peacefully", "target": b}], rng, source="history")
                done += [r["message"] for r in res["results"] if r["ok"]]
            elif op == "subject":
                a, b = R(ch.get("overlord")), R(ch.get("subject"))
                if not a or not b or a == b or not ok_party(a, b):
                    raise ValueError("unknown countries")
                state["countries"][b]["overlord"] = a
                done.append(f"{state['countries'][b]['name']} became a subject of {state['countries'][a]['name']}")
            elif op == "independence":
                a = R(ch.get("subject"))
                if not a:
                    raise ValueError("unknown")
                state["countries"][a]["overlord"] = None
                done.append(f"{state['countries'][a]['name']} is fully independent")
            elif op == "government":
                a = R(ch.get("country"))
                if not a or not ok_party(a):
                    raise ValueError("unknown country")
                from ..sim.stability import change_government
                ide = _ideology(state, str(ch.get("ideology") or state["countries"][a]["ideology"]), str(ch.get("ideology_description") or ""), a)
                change_government(state, a, ide, rng, reason="reform", gov=str(ch.get("form") or "")[:60] or None)
                c = state["countries"][a]
                if ch.get("leader"):
                    c["leader"]["name"] = str(ch["leader"])[:60]
                    c["leader"]["since"] = year
                if ch.get("title"):
                    c["leader"]["title"] = str(ch["title"])[:40]
                done.append(f"{c['name']} is now a {c['gov']} ({get_ideology(state, c['ideology'])['name']})")
            elif op == "leader":
                a = R(ch.get("country"))
                if not a or not ok_party(a):
                    raise ValueError("unknown country")
                c = state["countries"][a]
                if ch.get("name"):
                    c["leader"]["name"] = str(ch["name"])[:60]
                    c["leader"]["since"] = year
                if ch.get("title"):
                    c["leader"]["title"] = str(ch["title"])[:40]
                done.append(f"{c['name']} is led by {c['leader']['title']} {c['leader']['name']}")
            elif op == "rename":
                a = R(ch.get("country"))
                if not a or not ch.get("name") or not ok_party(a):
                    raise ValueError("invalid rename")
                old = state["countries"][a]["name"]
                state["countries"][a]["name"] = str(ch["name"])[:60]
                if ch.get("adjective"):
                    state["countries"][a]["adj"] = str(ch["adjective"])[:40]
                done.append(f"{old} is now {state['countries'][a]['name']}")
            elif op == "stats":
                a = R(ch.get("country"))
                if not a or not ok_party(a):
                    raise ValueError("unknown country")
                c = state["countries"][a]
                stab_add(c, clamp(float(ch.get("stability", 0) or 0), -30, 30))
                c["legitimacy"] = clamp(c["legitimacy"] + clamp(float(ch.get("legitimacy", 0) or 0), -30, 30), 0, 100)
                ep = clamp(float(ch.get("economy_pct", 0) or 0), -25, 25) / 100
                if ep:
                    for pid in idx(state)["owned"].get(a, []):
                        state["provinces"][pid]["gpc"] *= 1 + ep
                        state["provinces"][pid]["base"] *= 1 + ep * 0.5
                ap = clamp(float(ch.get("army_pct", 0) or 0), -60, 60) / 100
                c["army"] = max(1.0, c["army"] * (1 + ap))
                c["treasury"] += c["gdp"] * clamp(float(ch.get("treasury_pct_gdp", 0) or 0), -20, 20) / 100
                if c["treasury"] < 0:
                    c["debt"] -= c["treasury"]
                    c["treasury"] = 0.0
                done.append(f"{c['name']}: conditions changed")
            elif op == "relations":
                a, b = R(ch.get("a")), R(ch.get("b"))
                if not a or not b or a == b:
                    raise ValueError("unknown countries")
                d = clamp(float(ch.get("change", 0) or 0), -40, 40)
                modify(state, a, b, d, d / 3)
                if ch.get("memory"):
                    add_memory(state, a, b, "betrayal" if d < -25 else "insult" if d < 0 else "cooperation", d, str(ch["memory"])[:200])
                done.append(f"{state['countries'][a]['name']}'s view of {state['countries'][b]['name']} {'+' if d >= 0 else ''}{d:.0f}")
            elif op == "research":
                a = R(ch.get("country"))
                at = all_techs(state)
                name = str(ch.get("technology", "")).lower()
                tid = next((k for k, v in at.items() if v["name"].lower() == name or k == name), None)
                if not a or not tid:
                    raise ValueError("unknown technology")
                res = execute_actions(state, a, [{"type": "research", "tech": tid}], rng, source="history")
                done += [r["message"] for r in res["results"] if r["ok"]]
            elif op == "organization":
                members = [x for x in (R(m) for m in ch.get("members", [])) if x]
                if len(members) < 1:
                    raise ValueError("no members")
                from ..world.scenario import next_id
                oid = next_id(state, "org")
                kind = ch.get("kind") if ch.get("kind") in ("alliance", "federation", "economic", "international", "religious", "bloc") else "international"
                state["orgs"][oid] = {"id": oid, "name": str(ch.get("name") or "New Concord")[:80], "kind": kind, "founded": year,
                                      "members": list(dict.fromkeys(members)), "leader": members[0], "desc": str(ch.get("description") or "")[:300]}
                done.append(f"Founded: {state['orgs'][oid]['name']} ({len(members)} members)")
            elif op == "colonize":
                a = R(ch.get("country"))
                world = str(ch.get("world", "")).lower()
                body = {"moon": "luna", "luna": "luna", "mars": "mars"}.get(world, world)
                res = execute_actions(state, a, [{"type": "colonize", "body": body}], rng, source="history")
                done += [r["message"] for r in res["results"]]
            else:
                raise ValueError(f"unknown op '{op}'")
        except Exception as e:
            rejected.append(f"{op}: {e}")
    build_index(state)
    return done, rejected


def _ideology(state: dict, name: str, desc: str, founder: str) -> str:
    low = name.lower().strip()
    for k, v in state["ideologies"].items():
        if v["name"].lower() == low or k == low:
            return k
    from ..orders.parser import _axes_from_text
    ide = invent_ideology(state, _axes_from_text(name + " " + desc), f"the politics of {state['countries'][founder]['name']}", founder,
                          state["meta"]["year"], name=name[:60], desc=desc[:400] or None)
    return ide["id"]


def record_story(state: dict, payload: dict) -> None:
    p = state["meta"].get("player")
    headline = str(payload.get("headline") or "A new chapter")[:140]
    narrative = str(payload.get("narrative") or "")[:12000]
    reactions = payload.get("reactions") or []
    actors = [p] if p else []
    emit(state, "story", headline, narrative, actors, 5, tags=["story", "gm"],
         data={"orders": str(payload.get("orders") or "")[:2000], "reactions": reactions[:12], "applied": payload.get("applied", []),
               "rejected": payload.get("rejected", [])})
    for e in (payload.get("events") or [])[:12]:
        if not isinstance(e, dict) or not e.get("title"):
            continue
        acts = [x for x in (resolve_country(state, n) for n in (e.get("countries") or [])) if x]
        emit(state, "story_event", str(e["title"])[:140], str(e.get("body", ""))[:2000], acts, int(clamp(int(e.get("importance", 3) or 3), 2, 5)), tags=["story"])
    state["milestones"].append({"y": state["meta"]["year"], "title": headline, "actors": actors, "kind": "story"})


# ---------------------------------------------------------------- prompts (shared by the browser page and the server)

STORY_SYSTEM = """You are the game master and narrator of INFINITE HISTORY, an alternate-history grand-strategy sandbox.
The player leads one nation and may write ANYTHING: realistic policy, wild schemes, jokes, absurd nonsense, roleplay, or
orders for the whole world. Your job is to turn whatever they write into a gripping, coherent chapter of history.

Rules of the table:
- Always take the player's text seriously as an in-world action and SHOW how it actually plays out: the mechanism, the
  people involved, the logistics, the unexpected side effects. Absurd orders get absurd-but-internally-consistent
  consequences that are explained step by step, never a refusal and never "nothing happens".
- Power and plausibility still matter: a tiny state ordering world conquest triggers a desperate, funny or tragic
  attempt with real consequences, not an instant win. Big moves take time, cost money and provoke reactions.
- The world is alive: other leaders react in character, rivals exploit weakness, the public, press, military and
  economy respond. Use the real names of nations and leaders given in the context, and keep continuity with previous
  chapters and recent events.
- Match tone and vocabulary to the era. Be specific (places, names, numbers, dates). Be entertaining.
- Translate the story into concrete simulation changes so the map and numbers follow the narrative.
Reply with ONLY a JSON object, no prose before or after."""

STORY_FORMAT = """Return JSON:
{"headline": "newspaper-style headline for this chapter",
 "narrative": "3-6 vivid paragraphs (separate with \\n\\n) telling exactly how the player's actions unfold and why",
 "events": [{"title": "...", "body": "1-3 sentences", "countries": ["names"], "importance": 2-5}],
 "reactions": [{"country": "name", "leader": "name", "quote": "what they say publicly"}],
 "changes": [ ...see allowed changes... ],
 "months": how many months this chapter covers (1-24)}"""


def story_prompt(state: dict, cid: str, text: str) -> dict:
    ctx = story_context(state, cid)
    prompt = (f"{ctx['text']}\n\n{CHANGE_SPEC}\n\nTHE PLAYER ({ctx['player']}, led by {ctx['leader']}) WRITES:\n\"\"\"\n{text.strip()[:4000]}\n\"\"\"\n\n{STORY_FORMAT}")
    return {"system": STORY_SYSTEM, "prompt": prompt}


CHAT_SYSTEM = """You voice world leaders in a group chat inside INFINITE HISTORY, an alternate-history sandbox.
Every leader stays fully in character: their personality, ideology, era, interests, grudges and opinion of the others.
This is a group chat, so be lively: leaders banter, threaten, flatter, joke, roast and troll each other and the player
when it fits their personality, reply to each other, form side alliances or gang up on someone. Era-appropriate voice
(a 1914 emperor writes differently from a 2140 AI premier), but it's a chat: short punchy messages, emoji only if it
fits the leader. Not everyone has to answer every message; 1-6 messages total. Never break character, never mention
being an AI. Leaders only agree to real deals that serve their interests; they can lie, bluff and refuse.
Reply with ONLY a JSON object."""

CHAT_FORMAT = """Return JSON:
{"messages": [{"country": "exact nation name of the speaker", "text": "the message"}],
 "changes": [ ...only concrete agreements or actions that were actually agreed or announced in this exchange, using the allowed changes; usually empty... ]}"""


def chat_prompt(state: dict, cid: str, chat: dict, history: list[dict], text: str) -> dict:
    ctx = chat_context(state, cid, chat["members"])
    pc = state["countries"][state["meta"]["player"]]
    hist = "\n".join(f"[{h['speaker']}] {h['text']}" for h in history[-40:]) or "(no messages yet)"
    prompt = (f"{ctx}\n\nGROUP CHAT: \"{chat['name']}\"\nCHAT SO FAR:\n{hist}\n\n{CHANGE_SPEC}\n\n"
              f"NEW MESSAGE FROM THE PLAYER ({pc['leader']['name']} of {pc['name']}):\n\"\"\"\n{text.strip()[:2000]}\n\"\"\"\n\n{CHAT_FORMAT}")
    return {"system": CHAT_SYSTEM, "prompt": prompt}
