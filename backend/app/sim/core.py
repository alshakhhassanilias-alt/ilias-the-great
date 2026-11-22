"""Shared simulation helpers: indexes, modifiers, events and power calculations."""
from __future__ import annotations

from ..util import clamp, pair_key
from ..world.techtree import all_techs


def emit(state: dict, kind: str, title: str, body: str, actors: list[str] | None = None, importance: int = 2,
         provinces: list[str] | None = None, tags: list[str] | None = None, thread: str | None = None,
         data: dict | None = None) -> dict:
    """Queue a historical event; the service layer persists it to the chronicle database."""
    m = state["meta"]
    ev = {"year": m["year"], "month": m["month"], "kind": kind, "title": title, "body": body,
          "actors": [a for a in (actors or []) if a], "importance": importance, "provinces": provinces or [],
          "tags": tags or [], "thread": thread, "data": data or {}}
    state["pending_events"].append(ev)
    if thread and thread in state.get("threads", {}):
        th = state["threads"][thread]
        th.setdefault("beats", []).append({"y": m["year"], "t": title})
        th["beats"] = th["beats"][-30:]
    return ev


def alive(state: dict) -> list[str]:
    return [t for t, c in state["countries"].items() if c["alive"]]


def build_index(state: dict) -> dict:
    owned: dict[str, list[str]] = {}
    ctrl: dict[str, list[str]] = {}
    for pid, p in state["provinces"].items():
        if p["owner"]:
            owned.setdefault(p["owner"], []).append(pid)
        if p["ctrl"]:
            ctrl.setdefault(p["ctrl"], []).append(pid)
    state["_idx"] = {"owned": owned, "ctrl": ctrl}
    state["_nbc"] = {}
    state["_tix"] = None
    return state["_idx"]


def idx(state: dict) -> dict:
    return state.get("_idx") or build_index(state)


def owned(state: dict, tag: str) -> list[str]:
    return idx(state)["owned"].get(tag, [])


def controlled(state: dict, tag: str) -> list[str]:
    return idx(state)["ctrl"].get(tag, [])


PROD_F = 0.6   # calibration: share of a technology's nominal productivity effect realised
RES_F = 0.5    # calibration: share of a technology's nominal research effect realised


def compute_mods(state: dict, c: dict) -> dict:
    at = all_techs(state)
    prod = research = mil = 1.0
    pop = stab = naval = air = 0.0
    unlocks = set()
    for t in c["techs"]:
        e = at.get(t, {}).get("eff", {})
        prod *= 1 + e.get("prod", 0) * PROD_F
        research *= 1 + e.get("research", 0) * RES_F
        mil *= 1 + e.get("military", 0)
        pop += e.get("pop", 0)
        stab += e.get("stab", 0)
        naval += e.get("naval", 0)
        air += e.get("air", 0)
        unlocks.update(e.get("unlock", []))
    for law in c.get("laws", []):
        le = law.get("eff", {})
        prod *= 1 + le.get("prod", 0)
        research *= 1 + le.get("research", 0)
        stab += le.get("stab", 0)
    if c["tag"] == state["meta"].get("player"):
        diff = state["meta"].get("settings", {}).get("difficulty", "historical")
        f = {"easy": (1.05, 1.25, 1.25, 4), "sandbox": (1.15, 2.0, 2.0, 12), "hard": (0.95, 0.85, 0.9, -4)}.get(diff)
        if f:
            prod *= f[0]
            research *= f[1]
            mil *= f[2]
            stab += f[3]
    c["mods"] = {"prod": prod, "research": research, "mil": mil, "pop": pop, "stab": stab, "naval": naval, "air": air,
                 "unlocks": sorted(unlocks)}
    return c["mods"]


def has_unlock(c: dict, key: str) -> bool:
    return key in c.get("mods", {}).get("unlocks", [])


def land_power(c: dict) -> float:
    m = c.get("mods") or {}
    q = m.get("mil", 1.0) * (1 + c.get("mil_bonus", 0.0))
    morale = 0.65 + 0.005 * c["stability"] + 0.002 * c.get("war_support", 50)
    return (c["army"] / 100.0 + c["air"] / 600.0 * (1 + m.get("air", 0)) + c.get("space", 0) / 50.0) * q * morale


def naval_power(c: dict) -> float:
    m = c.get("mods") or {}
    return (c["navy"] / 50.0 * (1 + m.get("naval", 0)) + c.get("space", 0) / 30.0) * m.get("mil", 1.0)


def total_power(c: dict) -> float:
    return land_power(c) + 0.5 * naval_power(c) + (3.0 if c.get("nukes", 0) > 0 else 0)


def at_war(state: dict, a: str, b: str | None = None) -> bool:
    for w in state["wars"]:
        sa = a in w["att"] or a in w["def"]
        if not sa:
            continue
        if b is None:
            return True
        if (a in w["att"] and b in w["def"]) or (a in w["def"] and b in w["att"]):
            return True
    return False


def wars_of(state: dict, a: str) -> list[dict]:
    return [w for w in state["wars"] if a in w["att"] or a in w["def"]]


def _treaty_index(state: dict) -> dict:
    tr = state["treaties"]
    key = (len(tr), id(tr[-1]) if tr else 0)
    cache = state.get("_tix")
    if cache and cache[0] == key:
        return cache[1]
    ix: dict = {}
    for t in tr:
        ms = t["members"]
        for i in range(len(ms)):
            for j in range(len(ms)):
                if i != j:
                    ix.setdefault((ms[i], ms[j]), []).append(t)
    state["_tix"] = (key, ix)
    return ix


def treaty_between(state: dict, a: str, b: str, kinds: tuple = ("alliance", "defensive_pact")) -> dict | None:
    for t in _treaty_index(state).get((a, b), ()):
        if t["type"] in kinds and t in state["treaties"] and a in t["members"] and b in t["members"]:
            return t
    return None


def allies(state: dict, a: str) -> set[str]:
    out = set()
    for t in state["treaties"]:
        if t["type"] in ("alliance", "defensive_pact") and a in t["members"]:
            out.update(t["members"])
    for o in state["orgs"].values():
        if o["kind"] in ("alliance", "federation", "coalition") and a in o["members"]:
            out.update(o["members"])
    c = state["countries"].get(a)
    if c and c.get("overlord"):
        out.add(c["overlord"])
    out.update(t for t, x in state["countries"].items() if x.get("overlord") == a and x["alive"])
    out.discard(a)
    return {t for t in out if state["countries"].get(t, {}).get("alive")}


def world_totals(state: dict) -> dict:
    gdp = sum(c["gdp"] for c in state["countries"].values() if c["alive"])
    pop = sum(c["pop"] for c in state["countries"].values() if c["alive"])
    powr = sum(total_power(c) for c in state["countries"].values() if c["alive"])
    return {"gdp": gdp or 1, "pop": pop or 1, "power": powr or 1}


def bloc_of(state: dict, tag: str) -> set[str]:
    """A country plus its subjects (recursively)."""
    out = {tag}
    changed = True
    while changed:
        changed = False
        for t, c in state["countries"].items():
            if c["alive"] and c.get("overlord") in out and t not in out:
                out.add(t)
                changed = True
    return out


def year_frac(state: dict) -> float:
    return state["meta"]["year"] + (state["meta"]["month"] - 1) / 12


def country_name(state: dict, tag: str) -> str:
    c = state["countries"].get(tag)
    return c["name"] if c else tag


def rel_key(a: str, b: str) -> str:
    return pair_key(a, b)


def add_memory(state: dict, holder: str, other: str, kind: str, w: float, text: str) -> None:
    c = state["countries"].get(holder)
    if not c:
        return
    c["memories"].append({"y": state["meta"]["year"], "other": other, "kind": kind, "w": w, "text": text, "hist": False})
    if other in state["countries"]:
        from .relations import refresh_pair
        refresh_pair(state, holder, other)
    # keep memory bounded: merge oldest trivial memories
    if len(c["memories"]) > 80:
        c["memories"].sort(key=lambda m: (abs(m["w"]) >= 30, m["y"]))
        c["memories"] = c["memories"][-80:]


def stab_add(c: dict, v: float) -> None:
    c["stability"] = clamp(c["stability"] + v, 0, 100)
