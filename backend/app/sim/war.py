"""Warfare: declarations, alliance cascades, fronts, occupation, capitulation and peace."""
from __future__ import annotations

import math

from ..util import clamp, ordinal
from ..world.geo import get_geo
from .core import (add_memory, allies, at_war, build_index, emit, idx, land_power, naval_power, stab_add,
                   total_power, world_totals)
from .relations import modify, opinion


def _nb(state: dict, pid: str) -> list[str]:
    geo = get_geo()
    if pid in geo.provinces:
        return geo.provinces[pid]["nb"]
    return state.get("extra_geo", {}).get(pid, {}).get("nb", [])


def _sea(state: dict, pid: str) -> list[str]:
    geo = get_geo()
    return geo.provinces[pid].get("sea", []) if pid in geo.provinces else []


def war_name(state: dict, att: str, de: str, goal: str) -> str:
    ca, cd = state["countries"][att], state["countries"][de]
    if goal == "civil":
        return f"{cd['adj']} Civil War"
    if goal == "independence":
        return f"{ca['adj']} War of Independence"
    return f"{ca['adj']}-{cd['adj']} War"


def start_war(state: dict, attacker: str, defender: str, goal: str = "conquest", name: str | None = None,
              silent: bool = False, call_allies: bool = True, targets: list[str] | None = None) -> dict:
    for w in state["wars"]:
        if (attacker in w["att"] and defender in w["def"]) or (attacker in w["def"] and defender in w["att"]):
            return w
    from ..world.scenario import next_id
    year = state["meta"]["year"]
    w = {"id": next_id(state, "w"), "name": name or war_name(state, attacker, defender, goal), "att": [attacker], "def": [defender],
         "lead_att": attacker, "lead_def": defender, "start": year, "goal": goal, "targets": targets or [], "score": 0.0,
         "exh": {}, "cas": {}, "mom": 0.0, "terms": None, "world_war": False}
    state["wars"].append(w)
    ca, cd = state["countries"][attacker], state["countries"][defender]
    # broken treaties are betrayals the victim never forgets
    betrayed = False
    for t in list(state["treaties"]):
        if attacker in t["members"] and defender in t["members"]:
            if t["type"] in ("non_aggression", "alliance", "defensive_pact", "guarantee"):
                betrayed = True
            state["treaties"].remove(t)
    for pl in list(state.get("pledges", [])):
        if pl["from"] == attacker and pl["to"] == defender and pl["kind"] == "no_attack":
            betrayed = True
            state["pledges"].remove(pl)
    if not silent:
        if betrayed:
            add_memory(state, defender, attacker, "betrayal", -45, f"{ca['name']} broke its treaty and attacked in {year}.")
            for t in state["countries"]:
                if t not in (attacker, defender) and state["countries"][t]["alive"]:
                    modify(state, t, attacker, -5, -10)
        if goal in ("conquest", "subjugate"):
            add_memory(state, defender, attacker, "invasion", -50, f"{ca['name']} invaded in {year}.")
    if call_allies:
        for ally in sorted(allies(state, defender)):
            if ally == attacker or ally in w["def"] or ally in w["att"]:
                continue
            if ally in allies(state, attacker) and opinion(state, ally, attacker) > opinion(state, ally, defender):
                continue
            w["def"].append(ally)
        for ally in sorted(allies(state, attacker)):
            if ally in w["def"] or ally in w["att"]:
                continue
            ac = state["countries"][ally]
            if ac.get("overlord") == attacker or (opinion(state, ally, defender) < -10 and ac["leader"]["traits"]["agg"] > 0.35):
                w["att"].append(ally)
    _check_world_war(state, w, silent)
    from .relations import refresh_pair
    for x in w["att"]:
        for y in w["def"]:
            refresh_pair(state, x, y)
            refresh_pair(state, y, x)
    if not silent:
        joined = [state["countries"][t]["name"] for t in w["att"][1:] + w["def"][1:]]
        body = f"{ca['name']} has declared war on {cd['name']} ({_goal_text(goal)})."
        if joined:
            body += f" Drawn in by their commitments: {', '.join(joined[:8])}" + (f" and {len(joined) - 8} others." if len(joined) > 8 else ".")
        emit(state, "war", f"War: {w['name']}", body, w["att"] + w["def"], 5 if w["world_war"] else 4, tags=["war"], data={"war": w["id"]})
        from ..story.threads import open_thread
        th = open_thread(state, "war", w["name"], f"The {w['name']} began in {year}.", w["att"] + w["def"], key=w["id"])
        w["thread"] = th["id"]
    return w


def _goal_text(goal: str) -> str:
    return {"conquest": "a war of conquest", "subjugate": "to impose subjugation", "civil": "a struggle for the state itself",
            "independence": "a fight for independence", "liberation": "a war of liberation", "defense": "in self-defence"}.get(goal, goal)


def _check_world_war(state: dict, w: dict, silent: bool) -> None:
    if w["world_war"]:
        return
    tot = world_totals(state)["power"]
    if tot <= 0:
        return
    share_a = sum(total_power(state["countries"][t]) for t in w["att"]) / tot
    share_d = sum(total_power(state["countries"][t]) for t in w["def"]) / tot
    majors = sum(1 for t in w["att"] + w["def"] if total_power(state["countries"][t]) / tot > 0.05)
    if share_a > 0.15 and share_d > 0.15 and majors >= 4:
        n = state["meta"].get("world_wars", {"1914": 0, "1936": 1, "1962": 2, "2026": 2}.get(state["meta"]["scenario"], 0)) + 1
        state["meta"]["world_wars"] = n
        w["world_war"] = True
        old = w["name"]
        w["name"] = f"{['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth'][n-1] if n <= 10 else ordinal(n)} World War"
        if not silent:
            emit(state, "war", f"The {w['name']} begins", f"What began as the {old} has engulfed the great powers of the world.", w["att"] + w["def"], 5, tags=["war", "world_war"])


def join_war(state: dict, w: dict, tag: str, side: str) -> None:
    if tag in w["att"] or tag in w["def"]:
        return
    (w["att"] if side == "att" else w["def"]).append(tag)
    emit(state, "war", f"{state['countries'][tag]['name']} joins the {w['name']}", f"{state['countries'][tag]['name']} enters the war on the side of {state['countries'][w['lead_' + side]]['name']}.", [tag, w["lead_" + side]], 3)
    _check_world_war(state, w, False)


def _value(state: dict, pid: str) -> float:
    p = state["provinces"][pid]
    return 0.2 + p["pop"] * (1 + p["gpc"] / 20000)


def _frontier(state: dict, mine: set[str], enemy: set[str], my_naval: float, en_naval: float, space_ok: bool) -> list[str]:
    provs = state["provinces"]
    ctrl = idx(state)["ctrl"]
    my_prov = [pid for t in sorted(mine) for pid in ctrl.get(t, [])]
    out = set()
    for pid in my_prov:
        for nb in _nb(state, pid):
            q = provs.get(nb)
            if q and q["ctrl"] in enemy:
                if q["body"] != provs[pid]["body"]:
                    continue
                out.add(nb)
    if my_naval > en_naval * 1.15 + 0.2:
        for pid in my_prov:
            for nb in _sea(state, pid):
                q = provs.get(nb)
                if q and q["ctrl"] in enemy:
                    out.add(nb)
        if not out:
            # amphibious invasion of coastal provinces
            enemy_prov = [pid for t in sorted(enemy) for pid in ctrl.get(t, []) if provs[pid]["body"] == "earth" and _sea(state, pid)]
            enemy_prov.sort(key=lambda p: -_value(state, p))
            out.update(enemy_prov[:3])
    if space_ok:
        # space power projects force onto other worlds
        for t in sorted(enemy):
            for pid in ctrl.get(t, []):
                if provs[pid]["body"] != "earth":
                    out.add(pid)
    return sorted(out)


def war_tick(state: dict, dt: float, rng) -> None:
    for w in list(state["wars"]):
        if w not in state["wars"]:
            continue
        w["att"] = [t for t in w["att"] if state["countries"].get(t, {}).get("alive")]
        w["def"] = [t for t in w["def"] if state["countries"].get(t, {}).get("alive")]
        if not w["att"] or not w["def"]:
            end_war(state, w, "att" if w["att"] else "def", "The fighting ceased as one side ceased to exist.")
            continue
        A, D = set(w["att"]), set(w["def"])
        As, Ds = sorted(A), sorted(D)
        nw = {t: max(1, sum(1 for x in state["wars"] if t in x["att"] or t in x["def"])) for t in A | D}
        pA = sum(land_power(state["countries"][t]) / nw[t] for t in As) + 0.01
        pD = sum(land_power(state["countries"][t]) / nw[t] for t in Ds) * 1.1 + 0.01  # defender's advantage
        nA = sum(naval_power(state["countries"][t]) for t in As)
        nD = sum(naval_power(state["countries"][t]) for t in Ds)
        spA = any(state["countries"][t].get("space", 0) > 5 for t in As)
        spD = any(state["countries"][t].get("space", 0) > 5 for t in D)
        frA = _frontier(state, A, D, nA, nD, spA)
        frD = _frontier(state, D, A, nD, nA, spD)
        R = pA / pD
        net = (R - 1) / (R + 1)
        # an attacker that cannot reach the enemy makes no progress
        if net > 0 and not frA:
            net *= 0.05
        if net < 0 and not frD:
            net *= 0.05
        w["mom"] += dt * net * 9 * math.sqrt(max(1, len(frA if net > 0 else frD)))
        w["mom"] = clamp(w["mom"], -6, 6)
        if (w["mom"] >= 1 and frA) or (w["mom"] <= -1 and frD):
            w["last_change"] = state["meta"]["year"]
        while w["mom"] >= 1 and frA:
            pid = _pick(state, frA, A, rng, w.get("targets"))
            _capture(state, w, pid, A, rng)
            frA.remove(pid)
            w["mom"] -= 1
        while w["mom"] <= -1 and frD:
            pid = _pick(state, frD, D, rng)
            _capture(state, w, pid, D, rng)
            frD.remove(pid)
            w["mom"] += 1
        # casualties and exhaustion
        for side, other_ratio in ((As, 1 / max(R, 0.05)), (Ds, R)):
            for t in side:
                c = state["countries"][t]
                loss = c["army"] * dt * 0.05 * clamp(other_ratio, 0.2, 3.0)
                c["army"] = max(1.0, c["army"] - loss)
                w["cas"][t] = w["cas"].get(t, 0) + loss
                occ = _occupied_share(state, t)
                w["exh"][t] = clamp(w["exh"].get(t, 0) + dt * (4 + 40 * occ + 60 * loss / max(1.0, c["army"])), 0, 100)
                c["war_support"] = clamp(c.get("war_support", 50) - dt * (2 + 10 * occ), 0, 100)
        _score(state, w)
        # wars in which the front no longer moves end in negotiated settlements
        if state["meta"]["year"] - w.get("last_change", w["start"]) >= 8 and state["meta"]["year"] - w["start"] >= 8:
            if w["score"] > 20:
                apply_peace(state, w, w["lead_att"], w["lead_def"], "annex_occupied")
            elif w["score"] < -20:
                apply_peace(state, w, w["lead_def"], w["lead_att"], "annex_occupied")
            else:
                end_war(state, w, "none", f"With the front frozen for years, the belligerents of the {w['name']} agreed to an armistice.")
            continue
        for t in list(w["att"]) + list(w["def"]):
            if w not in state["wars"]:
                break
            occ = _occupied_share(state, t)
            c = state["countries"][t]
            cap_lost = c["capital"] and state["provinces"].get(c["capital"], {}).get("ctrl") not in (t, None) and \
                state["provinces"][c["capital"]]["ctrl"] not in (w["att"] if t in w["att"] else w["def"])
            if occ > 0.8 or (cap_lost and occ > 0.5) or (occ > 0.35 and w["exh"].get(t, 0) > 95):
                capitulate(state, w, t)


def _pick(state: dict, frontier: list[str], side: set[str], rng, targets: list[str] | None = None) -> str:
    provs = state["provinces"]
    tset = set(targets or [])
    caps = {state["countries"][t]["capital"] for t in state["countries"] if state["countries"][t]["alive"]}

    def score(pid):
        p = provs[pid]
        s = _value(state, pid) + rng.random() * 2
        if p["owner"] in side:
            s += 6  # liberate own land first
        if pid in caps:
            s += 3
        if pid in tset:
            s += 25
        return s
    return max(frontier, key=score)


def _capture(state: dict, w: dict, pid: str, side: set[str], rng) -> None:
    p = state["provinces"][pid]
    prev = p["ctrl"]
    if p["owner"] in side:
        new = p["owner"]
    else:
        # the strongest neighbouring member of the side takes control
        cand = sorted(side)
        new = max(cand, key=lambda t: land_power(state["countries"][t]) + (5 if t in p["cores"] else 0) + (3 if t == p["owner"] else 0))
    p["ctrl"] = new
    p["unrest"] = clamp(p["unrest"] + 10, 0, 100)
    build_index(state)
    caps = {c["capital"]: t for t, c in state["countries"].items() if c["alive"]}
    if pid in caps and caps[pid] == prev:
        loser = state["countries"][prev]
        stab_add(loser, -12)
        emit(state, "battle", f"{get_geo().name(pid) if pid in get_geo().provinces else pid} falls",
             f"Forces of {state['countries'][new]['name']} have taken {_pname(state, pid)}, capital of {loser['name']}.",
             [new, prev], 4, [pid], ["war"], w.get("thread"))
    elif p["pop"] > 5 and rng.random() < 0.5:
        emit(state, "battle", f"{_pname(state, pid)} captured",
             f"{state['countries'][new]['name']} captures {_pname(state, pid)} from {state['countries'][prev]['name'] if prev in state['countries'] else 'its defenders'} in the {w['name']}.",
             [new, prev], 2, [pid], ["war"], w.get("thread"))


def _pname(state: dict, pid: str) -> str:
    geo = get_geo()
    if pid in geo.provinces:
        return geo.provinces[pid]["name"]
    return state.get("extra_geo", {}).get(pid, {}).get("name", pid)


def _occupied_share(state: dict, tag: str) -> float:
    provs = state["provinces"]
    mine = idx(state)["owned"].get(tag, [])
    tot = sum(_value(state, p) for p in mine) or 1
    occ = sum(_value(state, p) for p in mine if provs[p]["ctrl"] != tag)
    return occ / tot


def _score(state: dict, w: dict) -> None:
    provs = state["provinces"]
    A, D = set(w["att"]), set(w["def"])
    o = idx(state)["owned"]
    dv = sum(_value(state, p) for t in sorted(D) for p in o.get(t, [])) or 1
    av = sum(_value(state, p) for t in sorted(A) for p in o.get(t, [])) or 1
    occ_d = sum(_value(state, p) for t in sorted(D) for p in o.get(t, []) if provs[p]["ctrl"] in A)
    occ_a = sum(_value(state, p) for t in sorted(A) for p in o.get(t, []) if provs[p]["ctrl"] in D)
    w["score"] = round(clamp(100 * occ_d / dv * 1.5 - 100 * occ_a / av * 1.5, -100, 100), 1)


def capitulate(state: dict, w: dict, loser: str) -> None:
    side_loser = "att" if loser in w["att"] else "def"
    winners = w["def"] if side_loser == "att" else w["att"]
    if not winners:
        return
    provs = state["provinces"]
    lc = state["countries"][loser]
    occupiers: dict[str, int] = {}
    for pid in idx(state)["owned"].get(loser, []):
        if provs[pid]["ctrl"] in winners:
            occupiers[provs[pid]["ctrl"]] = occupiers.get(provs[pid]["ctrl"], 0) + 1
    main = max(occupiers, key=occupiers.get) if occupiers else (w["lead_def"] if side_loser == "att" else w["lead_att"])
    player = state["meta"].get("player")
    terms = None
    if w.get("terms") and main == player:
        terms = w["terms"]
    elif w["goal"] == "civil" or w["goal"] == "independence":
        terms = "annex_all" if side_loser == "att" and w["goal"] == "civil" else ("recognize" if side_loser == "def" and w["goal"] == "independence" else "annex_all")
    elif main == player:
        terms = "annex_occupied" if w["goal"] == "conquest" else "puppet"
    else:
        mc = state["countries"][main]
        claims_held = sum(1 for p in idx(state)["owned"].get(loser, []) if p in mc["claims"])
        if mc["leader"]["traits"]["agg"] > 0.7 and w["goal"] == "conquest":
            terms = "annex_occupied"
        elif w["goal"] == "subjugate" or mc["leader"]["traits"]["amb"] > 0.6:
            terms = "puppet" if claims_held == 0 else "annex_claims_puppet"
        else:
            terms = "annex_claims"
    apply_peace(state, w, main, loser, terms)


def transfer_province(state: dict, pid: str, new_owner: str, reason: str = "conquest") -> None:
    p = state["provinces"][pid]
    old = p["owner"]
    if old == new_owner:
        p["ctrl"] = new_owner
        return
    p["owner"] = new_owner
    p["ctrl"] = new_owner
    core = new_owner in p["cores"]
    p["integ"] = 70.0 if core else (25.0 if reason != "peaceful" else 50.0)
    p["unrest"] = clamp(p["unrest"] + (5 if core else 20), 0, 100)
    nc = state["countries"][new_owner]
    nc["claims"].pop(pid, None)
    if old and old in state["countries"] and state["countries"][old]["alive"] and reason in ("conquest", "annexation") and old in p["cores"]:
        state["countries"][old]["claims"][pid] = state["meta"]["year"]
    hist = state.setdefault("ownership_log", [])
    hist.append([state["meta"]["year"], pid, old, new_owner, reason])
    if len(hist) > 6000:
        del hist[: len(hist) - 6000]


def apply_peace(state: dict, w: dict, winner: str, loser: str, terms: str) -> None:
    provs = state["provinces"]
    year = state["meta"]["year"]
    lc, wc = state["countries"][loser], state["countries"][winner]
    side_loser = "att" if loser in w["att"] else "def"
    winners = set(w["def"] if side_loser == "att" else w["att"])
    lost = []
    my = list(idx(state)["owned"].get(loser, []))
    desc = ""
    if terms in ("annex_occupied", "annex_claims", "annex_claims_puppet"):
        for pid in my:
            p = provs[pid]
            if p["ctrl"] in winners:
                taker = p["ctrl"]
                if terms.startswith("annex_claims") and pid not in state["countries"][taker]["claims"] and taker not in p["cores"]:
                    continue
                transfer_province(state, pid, taker, "conquest")
                lost.append(pid)
        desc = f"ceded {len(lost)} provinces" if lost else "made no territorial concessions"
        if terms == "annex_claims_puppet":
            lc["overlord"] = winner
            desc += f" and became a protectorate of {wc['name']}"
    elif terms == "annex_all":
        for pid in my:
            transfer_province(state, pid, provs[pid]["ctrl"] if provs[pid]["ctrl"] in winners else winner, "annexation")
            lost.append(pid)
        desc = "was annexed in its entirety"
    elif terms == "puppet":
        lc["overlord"] = winner
        desc = f"became a subject state of {wc['name']}"
    elif terms == "recognize":
        desc = "recognised its independence"
    elif terms == "white":
        desc = "agreed to a white peace"
    # restore control of everything else
    for pid in idx(state)["owned"].get(loser, []) + [p for p in my if provs[p]["owner"] == loser]:
        provs[pid]["ctrl"] = loser
    for pid, p in provs.items():
        if p["owner"] in winners and p["ctrl"] == loser:
            p["ctrl"] = p["owner"]
    build_index(state)
    if not idx(state)["owned"].get(loser):
        destroy_country(state, loser, winner, f"Annexed by {wc['name']} at the end of the {w['name']}.")
    if terms not in ("white", "recognize"):
        add_memory(state, loser, winner, "defeat", -40, f"Defeated by {wc['name']} in the {w['name']} ({year}); {desc}.")
        add_memory(state, winner, loser, "victory", -5, f"Victory over {lc['name']} in the {w['name']} ({year}).")
        if lost:
            add_memory(state, loser, winner, "territory_lost", -35, f"Lost {', '.join(_pname(state, p) for p in lost[:4])}{' and more' if len(lost) > 4 else ''} to {wc['name']} in {year}.")
    stab_add(lc, -10)
    stab_add(wc, 4)
    emit(state, "peace", f"{lc['name']} capitulates" if terms not in ("white", "recognize") else f"Peace between {lc['name']} and {wc['name']}",
         f"Ending its part in the {w['name']}, {lc['name']} {desc}.", [loser, winner], 4, lost[:12], ["peace"], w.get("thread"),
         data={"terms": terms, "provinces": lost})
    # remove loser and its subjects from the war
    for t in [loser] + [x for x, c in state["countries"].items() if c.get("overlord") == loser]:
        if t in w["att"]:
            w["att"].remove(t)
        if t in w["def"]:
            w["def"].remove(t)
    if not w["att"] or not w["def"] or (side_loser == "att" and w["lead_att"] == loser and terms != "recognize") or (side_loser == "def" and w["lead_def"] == loser):
        end_war(state, w, "def" if side_loser == "att" else "att", f"The {w['name']} ended with the defeat of {lc['name']}.")


def end_war(state: dict, w: dict, victor_side: str, text: str) -> None:
    if w not in state["wars"]:
        return
    state["wars"].remove(w)
    provs = state["provinces"]
    members = set(w["att"]) | set(w["def"])
    for pid, p in provs.items():
        if p["ctrl"] != p["owner"] and (p["ctrl"] in members or p["owner"] in members):
            if not any((p["ctrl"] in x["att"] and p["owner"] in x["def"]) or (p["ctrl"] in x["def"] and p["owner"] in x["att"]) for x in state["wars"]):
                p["ctrl"] = p["owner"]
    build_index(state)
    for t in members:
        if t in state["countries"]:
            state["countries"][t]["exhaustion"] = w["exh"].get(t, 0)
    dur = state["meta"]["year"] - w["start"]
    cas = sum(w["cas"].values())
    emit(state, "war_end", f"End of the {w['name']}", f"{text} The war lasted {dur} year{'s' if dur != 1 else ''} and cost an estimated {cas:,.0f} thousand military casualties.",
         list(members), 4 if not w["world_war"] else 5, tags=["peace"], thread=w.get("thread"))
    from ..story.threads import close_thread
    if w.get("thread"):
        close_thread(state, w["thread"], text)


def destroy_country(state: dict, tag: str, by: str | None, text: str) -> None:
    c = state["countries"][tag]
    if not c["alive"]:
        return
    c["alive"] = False
    c["fell"] = state["meta"]["year"]
    c["fell_text"] = text
    for t in list(state["treaties"]):
        if tag in t["members"]:
            t["members"].remove(tag)
            if len(t["members"]) < 2:
                state["treaties"].remove(t)
    for o in state["orgs"].values():
        if tag in o["members"]:
            o["members"].remove(tag)
    for x in state["countries"].values():
        if x.get("overlord") == tag:
            x["overlord"] = None
    for w in list(state["wars"]):
        for side in ("att", "def"):
            if tag in w[side]:
                w[side].remove(tag)
    founded = c.get("founded")
    span = f" after {state['meta']['year'] - founded} years" if founded else ""
    emit(state, "collapse", f"{c['name']} ceases to exist", f"{text} {c['name']} has disappeared from the map{span}.", [tag] + ([by] if by else []), 5 if c["pop"] > 50 else 4,
         tags=["fall"])
    state["milestones"].append({"y": state["meta"]["year"], "title": f"Fall of {c['name']}", "actors": [tag], "kind": "fall"})


def propose_peace(state: dict, w: dict, proposer: str, terms: str) -> tuple[bool, str]:
    """Evaluate a peace proposal from one belligerent to the opposing war leader."""
    side = "att" if proposer in w["att"] else "def"
    other_lead = w["lead_def"] if side == "att" else w["lead_att"]
    if other_lead not in state["countries"] or not state["countries"][other_lead]["alive"]:
        other_lead = (w["def"] if side == "att" else w["att"])[0]
    oc = state["countries"][other_lead]
    score = w["score"] if side == "att" else -w["score"]  # from proposer's perspective
    exh_other = w["exh"].get(other_lead, 0)
    if terms == "white":
        accept = score > -15 and (exh_other > 35 or score > 10) or exh_other > 75
    elif terms in ("annex_occupied", "annex_claims", "puppet", "annex_claims_puppet"):
        accept = score > 45 or (score > 25 and exh_other > 60)
    elif terms == "surrender":
        accept = True
    else:
        accept = False
    if state["meta"].get("player") == other_lead:
        accept = False  # the player answers via a decision instead
    if accept:
        if terms == "surrender":
            apply_peace(state, w, other_lead, proposer, "annex_occupied")
        elif terms == "white":
            end_war(state, w, "none", f"A negotiated white peace ended the {w['name']}.")
            for a in (proposer, other_lead):
                stab_add(state["countries"][a], 3)
        else:
            apply_peace(state, w, proposer, other_lead, terms)
        return True, f"{oc['name']} accepted."
    return False, f"{oc['name']} rejected the proposal (war score {score:+.0f}, their exhaustion {exh_other:.0f}%)."
