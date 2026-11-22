"""AI-controlled states: research priorities, budgets, alliances, wars, peace, colonisation and policy.
Each AI country pursues its own interests shaped by its leader's personality and its historical memory."""
from __future__ import annotations

from ..util import clamp, stable_hash
from ..world.ideologies import get_ideology
from ..world.techtree import all_techs, available
from .core import (alive, allies, at_war, emit, idx, land_power, naval_power, total_power, treaty_between, wars_of,
                   world_totals)
from .relations import modify, neighbors_of, opinion, trust

CAT_BIAS = {"agg": {"military": 2.0}, "amb": {"space": 1.2, "industry": 1.2}, "cau": {"society": 1.3, "biology": 1.2},
            "prag": {"industry": 1.4, "computing": 1.3}}


def choose_research(state: dict, c: dict) -> str | None:
    known = set(c["techs"])
    av = available(state, known)
    if not av:
        return None
    tr = c["leader"]["traits"]
    focus = c.get("focus")
    war = at_war(state, c["tag"])

    def w(t):
        x = 1.0 / (1 + t["tier"] * 0.15)
        x *= 1.0 / (1.8 ** (t["tier"] - min(a["tier"] for a in av)))
        for trait, bias in CAT_BIAS.items():
            x *= 1 + (bias.get(t["cat"], 1.0) - 1) * tr.get(trait, 0.5)
        if war and t["cat"] == "military":
            x *= 2.5
        if focus and t["cat"] == focus:
            x *= 6
        if focus and t["id"] == focus:
            x *= 50
        ide = get_ideology(state, c["ideology"])
        if t["eff"].get("controversy") in ("upload", "enhancement", "collective") and ide["axes"]["prog"] < -0.4:
            x *= 0.2
        return x
    return max(av, key=w)["id"]


def ai_tick(state: dict, dt: float, rng) -> None:
    player = state["meta"].get("player")
    tot = world_totals(state)
    n_wars = len(state["wars"])
    for t in alive(state):
        c = state["countries"][t]
        if t == player or not c.get("ai", True):
            continue
        # stagger yearly decisions across months when ticking monthly
        if dt < 1 and (stable_hash(t) + state["meta"]["month"]) % 12 != 0:
            continue
        step = max(dt, 1.0) if dt < 1 else dt
        _budget(state, c)
        _policies(state, c)
        _peace(state, c, rng)
        _alliances(state, c, rng, step, tot)
        if n_wars < 7:
            if _maybe_war(state, c, rng, step, tot):
                n_wars += 1
        _trade(state, c, rng, step)
        _colonize(state, c, rng)
        _subject_independence(state, c, rng, step)
        _decolonize(state, c, rng, step)


def _budget(state: dict, c: dict) -> None:
    tr = c["leader"]["traits"]
    b = c["budget"]
    year = state["meta"]["year"]
    mil = 0.015 + 0.05 * tr["agg"]
    if c["debt"] > c["gdp"] * 0.8:
        mil *= 0.7
    b["military"] = round(clamp(mil, 0.01, 0.12), 3)
    base_r = 0.004 if year < 1800 else 0.01 if year < 1940 else 0.02 if year < 2000 else 0.03 if year < 2100 else 0.04
    b["research"] = round(base_r * (0.7 + 0.6 * tr["prag"]), 4)
    b["welfare"] = round(0.02 + 0.03 * tr["cau"], 3)
    b["infra"] = round(0.015 + 0.02 * tr["prag"], 3)
    # prudent governments keep peacetime spending within revenue (about 12% of GDP after administration)
    income = 0.20 if c["policies"].get("economy") != "planned" else 0.24
    room = income - 0.08 - (0.0 if c["debt"] < c["gdp"] * 0.5 else 0.015)
    total = b["military"] + b["research"] + b["welfare"] + b["infra"]
    if total > room and not at_war(state, c["tag"]):
        f = room / total
        for k in ("military", "research", "welfare", "infra"):
            b[k] = round(b[k] * f, 4)
    if at_war(state, c["tag"]):
        c["policies"]["mobilization"] = "total" if tr["agg"] > 0.7 or any(w["score"] * (1 if c["tag"] in w["def"] else -1) > 40 for w in wars_of(state, c["tag"])) else "partial"
    if "space_military" in c["mods"].get("unlocks", []):
        c["mil_mix"] = {"army": 0.45, "navy": 0.15, "air": 0.2, "space": 0.2}


def _policies(state: dict, c: dict) -> None:
    ide = get_ideology(state, c["ideology"])
    ax = ide["axes"]
    u = set(c["mods"].get("unlocks", []))
    pol = c["policies"]
    if "upload" in u:
        pol["digital_rights"] = "equal" if ax["substrate"] > 0.3 else "limited" if ax["prog"] > 0 else "none"
        pol["upload"] = "encouraged" if ax["substrate"] > 0.6 else "banned" if ax["substrate"] < -0.8 else "voluntary"
    if "ai_minds" in u:
        pol["ai_rights"] = "equal" if ax["substrate"] > 0.5 else "limited" if ax["prog"] > 0.3 else "none"
    if c["flags"].get("digital_tension", 0) > 25 and pol.get("digital_rights") == "none":
        pol["digital_rights"] = "limited"
    pol["integration"] = "suppress" if ax["auth"] > 0.6 else "autonomy" if ax["central"] < -0.3 else "assimilate"
    colonies = [p for p in idx(state)["owned"].get(c["tag"], []) if state["provinces"][p]["body"] != c["home"]]
    if colonies and max(state["provinces"][p].get("autonomy_desire", 0) for p in colonies) > 50:
        pol["colonial"] = "autonomy" if ax["auth"] < 0.4 else "direct"


def _peace(state: dict, c: dict, rng) -> None:
    from .war import propose_peace
    player = state["meta"].get("player")
    for w in list(wars_of(state, c["tag"])):
        lead = w["lead_att"] if c["tag"] in w["att"] else w["lead_def"]
        if lead != c["tag"]:
            continue
        my_score = w["score"] if c["tag"] in w["att"] else -w["score"]
        exh = w["exh"].get(c["tag"], 0)
        other = w["lead_def"] if c["tag"] in w["att"] else w["lead_att"]
        if other == player:
            if exh > 70 and my_score < 0 and not any(d["kind"] == "peace_offer" and d["data"].get("war") == w["id"] for d in state["decisions"]):
                from ..story.decisions import add_decision
                add_decision(state, "peace_offer", f"{c['name']} sues for peace",
                             f"Exhausted by the {w['name']} ({exh:.0f}% war exhaustion), {c['name']} offers terms.",
                             [("accept_occupied", "Accept: annex what we occupy", "They cede every province we currently hold."),
                              ("white", "Accept a white peace", "Both sides return to pre-war borders."),
                              ("reject", "Fight on", "Reject the offer.")], data={"war": w["id"], "from": c["tag"]}, owner=player)
            continue
        if my_score > 45 and exh > 20:
            propose_peace(state, w, c["tag"], "annex_claims_puppet" if c["leader"]["traits"]["amb"] > 0.6 else "annex_occupied")
        elif exh > 65 and my_score < 20:
            ok, _ = propose_peace(state, w, c["tag"], "white")
            if not ok and my_score < -45:
                propose_peace(state, w, c["tag"], "surrender")


def _threat(state: dict, me: str, other: str) -> float:
    cm, co = state["countries"][me], state["countries"][other]
    ratio = total_power(co) / max(0.05, total_power(cm))
    op = opinion(state, me, other)
    return ratio * (1 + co["leader"]["traits"]["agg"]) * (1 if op < 0 else 0.3) * (1 + max(0, -op) / 50)


def _alliances(state: dict, c: dict, rng, step: float, tot: dict) -> None:
    me = c["tag"]
    nbs = neighbors_of(state, me)
    if not nbs:
        return
    threats = sorted(((_threat(state, me, o), o) for o in sorted(nbs)), reverse=True)
    top_threat, th = threats[0]
    if top_threat < 1.5 or rng.random() > 0.35 * step:
        return
    mine = allies(state, me)
    candidates = []
    for o in alive(state):
        if o in (me, th) or o in mine or state["countries"][o].get("overlord"):
            continue
        if opinion(state, o, th) > 10 or treaty_between(state, o, th):
            continue
        o_nbs = neighbors_of(state, o)
        if not (o in nbs or th in o_nbs or me in o_nbs):
            continue
        if _cap_dist(state, me, o) > 3000 and _cap_dist(state, th, o) > 3000:
            continue
        if opinion(state, o, th) > -5 and th not in o_nbs:
            continue
        score = opinion(state, o, me) + opinion(state, me, o) + total_power(state["countries"][o]) / tot["power"] * 300 + 20
        if score > 30:
            candidates.append((score, o))
    if not candidates:
        return
    _, partner = max(candidates)
    if state["meta"].get("player") == partner:
        from ..story.decisions import add_decision
        last = c["flags"].get("offered_player", -999)
        if state["meta"]["year"] - last < 15 or opinion(state, partner, th) > 0:
            return
        c["flags"]["offered_player"] = state["meta"]["year"]
        if not any(d["kind"] == "alliance_offer" and d["data"].get("from") == me for d in state["decisions"]):
            add_decision(state, "alliance_offer", f"{c['name']} proposes an alliance",
                         f"Alarmed by {state['countries'][th]['name']}, {c['name']} ({c['leader']['name']}) proposes a defensive pact.",
                         [("accept", "Sign the defensive pact", "Each side will defend the other if attacked."), ("decline", "Decline politely", "Relations cool slightly.")],
                         data={"from": me, "against": th}, owner=partner)
        return
    from ..world.scenario import next_id
    state["treaties"].append({"id": next_id(state, "t"), "type": "defensive_pact", "members": [me, partner], "since": state["meta"]["year"],
                              "name": f"{c['adj']}-{state['countries'][partner]['adj']} Defensive Pact", "secret": False})
    modify(state, me, partner, 10, 5)
    modify(state, partner, me, 10, 5)
    emit(state, "diplomacy", f"{c['name']} and {state['countries'][partner]['name']} sign a defensive pact",
         f"Fearing {state['countries'][th]['name']}, the two states have pledged mutual defence.", [me, partner, th], 3, tags=["treaty"])


def _maybe_war(state: dict, c: dict, rng, step: float, tot: dict) -> bool:
    from .war import start_war
    me = c["tag"]
    tr = c["leader"]["traits"]
    if tr["agg"] < 0.5 or c["stability"] < 35 or at_war(state, me) or c.get("overlord"):
        return False
    if c.get("exhaustion", 0) > 20:
        return False
    year = state["meta"]["year"]
    restraint = 1.0 if year < 1950 else 0.45 if year < 2100 else 0.6
    nbs = neighbors_of(state, me)
    best = None
    for o in sorted(nbs):
        oc = state["countries"][o]
        if oc.get("overlord") == me or treaty_between(state, me, o, ("alliance", "defensive_pact")):
            continue
        claims = sum(1 for pid in c["claims"] if state["provinces"].get(pid, {}).get("owner") == o)
        op = opinion(state, me, o)
        if claims == 0 and op > -35:
            continue
        mine = land_power(c) + sum(land_power(state["countries"][a]) * 0.5 for a in sorted(allies(state, me)))
        theirs = land_power(oc) * 1.1 + sum(land_power(state["countries"][a]) * 0.7 for a in sorted(allies(state, o)))
        if oc.get("nukes", 0) > 0 and c.get("nukes", 0) == 0:
            theirs *= 3
        ratio = mine / max(0.01, theirs)
        if ratio < 1.6:
            continue
        val = ratio * (1 + claims) * (1 + max(0, -op) / 60)
        if not best or val > best[0]:
            best = (val, o, claims)
    if not best:
        return False
    p = step * 0.12 * tr["agg"] * min(3, best[0] / 2) * restraint
    if best[1] == state["meta"].get("player"):
        p *= {"sandbox": 0.3, "easy": 0.6, "hard": 1.5}.get(state["meta"].get("settings", {}).get("difficulty", "historical"), 1.0)
    if rng.random() > p:
        return False
    target = best[1]
    if target == state["meta"].get("player"):
        # give the player a chance to respond to an ultimatum first when claims are involved
        if best[2] and not any(d["kind"] == "ultimatum" and d["data"].get("from") == me for d in state["decisions"]):
            from ..story.decisions import add_decision
            claimed = [pid for pid in c["claims"] if state["provinces"].get(pid, {}).get("owner") == target]
            from .war import _pname
            add_decision(state, "ultimatum", f"Ultimatum from {c['name']}",
                         f"{c['leader']['name']} demands the cession of {', '.join(_pname(state, p) for p in claimed[:5])}. Refusal means war.",
                         [("cede", "Cede the territory", "Avoid war at the cost of land and prestige."), ("refuse", "Refuse", "Prepare for war.")],
                         data={"from": me, "provinces": claimed}, owner=target)
            return False
    start_war(state, me, target, "conquest")
    return True


def _trade(state: dict, c: dict, rng, step: float) -> None:
    if rng.random() > 0.15 * step:
        return
    me = c["tag"]
    player = state["meta"].get("player")
    cands = [o for o in sorted(neighbors_of(state, me) | allies(state, me)) if o != player and not treaty_between(state, me, o, ("trade",))
             and opinion(state, me, o) > 20 and opinion(state, o, me) > 10]
    if not cands:
        return
    o = rng.choice(sorted(cands))
    from ..world.scenario import next_id
    state["treaties"].append({"id": next_id(state, "t"), "type": "trade", "members": [me, o], "since": state["meta"]["year"],
                              "name": f"{c['adj']}-{state['countries'][o]['adj']} Trade Agreement", "secret": False})


def _colonize(state: dict, c: dict, rng) -> None:
    from .space import colony_cost, free_regions, start_colony
    if any(p["kind"] == "colonize" for p in c["projects"]):
        return
    if not state["bodies"]:
        return
    for body in sorted(state["bodies"], key=lambda b: ["luna", "mars", "belt", "venus", "jovian", "saturnian", "proxima", "tau_ceti", "trappist"].index(b) if b in ["luna", "mars", "belt", "venus", "jovian", "saturnian", "proxima", "tau_ceti", "trappist"] else 99):
        from ..world.geo import BODIES
        req = BODIES[body]["requires"]
        if req not in c["techs"]:
            continue
        free = free_regions(state, body)
        if not free:
            continue
        cost, years = colony_cost(state, body, c)
        if c["gdp"] * 0.01 * years < cost or c["treasury"] < cost * 0.2:
            continue
        if rng.random() < 0.5 + 0.4 * c["leader"]["traits"]["amb"]:
            start_colony(state, c["tag"], rng.choice(sorted(free)))
            return


def _subject_independence(state: dict, c: dict, rng, step: float) -> None:
    ov = c.get("overlord")
    if not ov:
        return
    oc = state["countries"].get(ov)
    if not oc or not oc["alive"]:
        c["overlord"] = None
        return
    if opinion(state, c["tag"], ov) > -20 or rng.random() > 0.08 * step:
        return
    if land_power(c) * 2.5 < land_power(oc):
        return
    from .war import start_war
    c["overlord"] = None
    start_war(state, c["tag"], ov, "independence", call_allies=False)


def _decolonize(state: dict, c: dict, rng, step: float) -> None:
    """AI empires release restless colonies of other peoples rather than fight endless insurgencies."""
    if state["meta"]["year"] < 1940:
        return
    from collections import defaultdict
    groups = defaultdict(list)
    for pid in idx(state)["owned"].get(c["tag"], []):
        p = state["provinces"][pid]
        if c["tag"] not in p["cores"] and p["culture"] != c["culture"] and p["body"] == "earth":
            groups[p["code"]].append(pid)
    ide = get_ideology(state, c["ideology"])
    for code, ps in groups.items():
        avg = sum(state["provinces"][p]["unrest"] for p in ps) / len(ps)
        if avg < 40:
            continue
        p_rel = step * 0.06 * (1.6 if ide["family"] == "democratic" else 0.7) * (avg / 50) * (1.5 if c.get("exhaustion", 0) > 30 else 1)
        if rng.random() < p_rel and len(ps) < len(idx(state)["owned"].get(c["tag"], [])):
            from .successors import create_country
            nt = create_country(state, ps, parent=c["tag"], kind="grant", rng=rng, origin=f"Granted independence by {c['name']} in {state['meta']['year']}.")
            emit(state, "independence", f"{state['countries'][nt]['name']} gains independence", f"Facing a nationalist movement it could no longer contain, {c['name']} has granted independence to {state['countries'][nt]['name']}.",
                 [nt, c["tag"]], 3, ps[:6], ["independence", "decolonisation"])
            from .core import build_index
            build_index(state)
            return


def _cap_dist(state: dict, a: str, b: str) -> float:
    from ..world.geo import get_geo
    g = get_geo()
    ca, cb = state["countries"][a].get("capital"), state["countries"][b].get("capital")
    if ca in g.provinces and cb in g.provinces:
        return g.distance(ca, cb)
    return 0.0 if state["countries"][a].get("home") == state["countries"][b].get("home") else 1e9
