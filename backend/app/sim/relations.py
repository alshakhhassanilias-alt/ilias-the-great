"""Directional opinions computed from ideology, historical memory, treaties, wars and diplomacy."""
from __future__ import annotations

import math

from ..util import clamp
from ..world.geo import get_geo
from ..world.ideologies import get_ideology, similarity
from .core import alive, idx, total_power, treaty_between

HALF_LIFE = {"invasion": 120, "territory_lost": 150, "treaty_imposed": 80, "defeat": 90, "betrayal": 70, "interference": 45,
             "war": 60, "independence": 80, "cooperation": 40, "treaty": 30, "victory": 60, "liberation": 100, "aid": 25,
             "insult": 15, "threat": 20, "gift": 20, "succession": 200, "oppression": 120}


def memory_weight(m: dict, year: int) -> float:
    age = max(0, year - m["y"])
    hl = HALF_LIFE.get(m["kind"], 50)
    w = m["w"] * (0.5 ** (age / hl))
    # deep grievances never fully fade: they become part of national memory
    if abs(m["w"]) >= 40:
        floor = m["w"] * 0.12
        w = w if abs(w) > abs(floor) else floor
    return w


def neighbors_of(state: dict, tag: str) -> set[str]:
    cache = state.setdefault("_nbc", {})
    if tag in cache:
        return cache[tag]
    cache[tag] = _neighbors_of(state, tag)
    return cache[tag]


def _neighbors_of(state: dict, tag: str) -> set[str]:
    geo = get_geo()
    out = set()
    provs = state["provinces"]
    for pid in idx(state)["owned"].get(tag, []):
        if pid in geo.provinces:
            for nb in geo.provinces[pid]["nb"]:
                o = provs.get(nb, {}).get("owner")
                if o and o != tag:
                    out.add(o)
        else:
            for nb in state.get("extra_geo", {}).get(pid, {}).get("nb", []):
                o = provs.get(nb, {}).get("owner")
                if o and o != tag:
                    out.add(o)
    return out


def relevant(state: dict, tag: str, majors: list[str]) -> set[str]:
    c = state["countries"][tag]
    s = set(majors) | neighbors_of(state, tag) | {m["other"] for m in c["memories"]}
    for t in state["treaties"]:
        if tag in t["members"]:
            s.update(t["members"])
    for w in state["wars"]:
        if tag in w["att"] or tag in w["def"]:
            s.update(w["att"] + w["def"])
    if state["meta"].get("player"):
        s.add(state["meta"]["player"])
    s.discard(tag)
    return {x for x in s if state["countries"].get(x, {}).get("alive")}


def compute_opinion(state: dict, a: str, b: str) -> tuple[float, float]:
    ca, cb = state["countries"][a], state["countries"][b]
    year = state["meta"]["year"]
    ia, ib = get_ideology(state, ca["ideology"]), get_ideology(state, cb["ideology"])
    op = (similarity(ia, ib) - 0.55) * 60
    trust = 50.0
    for m in ca["memories"]:
        if m["other"] == b:
            w = memory_weight(m, year)
            op += w
            if m["kind"] == "betrayal":
                trust += w * 0.8
            elif m["kind"] in ("treaty", "cooperation", "aid"):
                trust += w * 0.3
    if treaty_between(state, a, b, ("alliance", "defensive_pact")):
        op += 25
        trust += 15
    if treaty_between(state, a, b, ("trade",)):
        op += 8
    if treaty_between(state, a, b, ("non_aggression",)):
        op += 5
    for w in state["wars"]:
        if (a in w["att"] and b in w["def"]) or (a in w["def"] and b in w["att"]):
            op -= 60
            trust -= 20
    # claims on our land
    provs = state["provinces"]
    lost = sum(1 for pid in cb["claims"] if provs.get(pid, {}).get("owner") == a)
    if lost:
        op -= min(35, 8 * lost)
    mine = sum(1 for pid in ca["claims"] if provs.get(pid, {}).get("owner") == b)
    if mine:
        op -= min(30, 6 * mine)
    if cb.get("overlord") == a or ca.get("overlord") == b:
        op += 10
    op += state["relations"].get(f"{a}>{b}", {}).get("mod", 0.0)
    trust += state["relations"].get(f"{a}>{b}", {}).get("tmod", 0.0)
    return clamp(op, -100, 100), clamp(trust, 0, 100)


def recompute_opinions(state: dict, initial: bool = False) -> None:
    tags = alive(state)
    majors = sorted(tags, key=lambda t: -total_power(state["countries"][t]) if state["countries"][t].get("mods") else -len(idx(state)["owned"].get(t, [])))[:12]
    ops = {}
    for a in tags:
        for b in relevant(state, a, majors):
            ops[f"{a}>{b}"] = [round(x, 1) for x in compute_opinion(state, a, b)]
    state["opinions"] = ops


def refresh_pair(state: dict, a: str, b: str) -> None:
    if a in state["countries"] and b in state["countries"]:
        state.setdefault("opinions", {})[f"{a}>{b}"] = [round(x, 1) for x in compute_opinion(state, a, b)]


def opinion(state: dict, a: str, b: str) -> float:
    v = state.get("opinions", {}).get(f"{a}>{b}")
    if v is None:
        if a not in state["countries"] or b not in state["countries"]:
            return 0.0
        v = compute_opinion(state, a, b)
    return v[0]


def trust(state: dict, a: str, b: str) -> float:
    v = state.get("opinions", {}).get(f"{a}>{b}")
    if v is None:
        if a not in state["countries"] or b not in state["countries"]:
            return 50.0
        v = compute_opinion(state, a, b)
    return v[1]


def modify(state: dict, a: str, b: str, op: float = 0, tr: float = 0) -> None:
    r = state["relations"].setdefault(f"{a}>{b}", {"mod": 0.0, "tmod": 0.0})
    r["mod"] = clamp(r["mod"] + op, -80, 80)
    r["tmod"] = clamp(r["tmod"] + tr, -60, 60)
    key = f"{a}>{b}"
    if key in state.get("opinions", {}):
        state["opinions"][key] = [round(x, 1) for x in compute_opinion(state, a, b)]


def set_opinion(state: dict, a: str, b: str, value: float) -> None:
    cur = opinion(state, a, b)
    modify(state, a, b, value - cur)


def decay_mods(state: dict, dt: float) -> None:
    for k, r in list(state["relations"].items()):
        r["mod"] *= math.exp(-dt / 12)
        r["tmod"] *= math.exp(-dt / 25)
        if abs(r["mod"]) < 0.5 and abs(r["tmod"]) < 0.5:
            del state["relations"][k]
