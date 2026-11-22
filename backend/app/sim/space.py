"""Extraterrestrial expansion: unlocking bodies, colonisation projects, colony growth and autonomy."""
from __future__ import annotations

from ..util import clamp
from ..world.geo import BODIES, body_regions
from ..world.techtree import UNLOCK_BODY
from .core import build_index, emit, idx


def on_unlock(state: dict, c: dict, key: str) -> None:
    for body in UNLOCK_BODY.get(key, []):
        unlock_body(state, body, c["tag"])
    if key == "terraform":
        pass


def unlock_body(state: dict, body: str, by: str) -> None:
    if body in state["bodies"]:
        return
    b = BODIES[body]
    state["bodies"][body] = {"id": body, "name": b["name"], "kind": b["kind"], "unlocked": state["meta"]["year"], "by": by, "terraform": 0.0}
    eg = state.setdefault("extra_geo", {})
    for r in body_regions(body):
        eg[r["id"]] = {"name": r["name"], "c": r["c"], "nb": r["nb"], "body": body}
        state["provinces"][r["id"]] = {"owner": None, "ctrl": None, "pop": 0.0, "gpc": 0.0, "base": 0.0, "unrest": 0.0, "integ": 100.0,
                                      "culture": body, "code": body.upper(), "cores": [], "body": body, "dev": 1.0, "autonomy": 0,
                                      "founded": None}
    emit(state, "space", f"{b['name']} opens to settlement", f"With the technology pioneered by {state['countries'][by]['name']}, permanent human presence on {b['name']} has become possible. {len(b['regions'])} regions await claimants.",
         [by], 4, tags=["space"])
    state["milestones"].append({"y": state["meta"]["year"], "title": f"{b['name']} opened to settlement", "actors": [by], "kind": "space"})


COLONY_COST = {"luna": (40, 4), "mars": (160, 8), "belt": (90, 6), "jovian": (300, 12), "saturnian": (350, 14), "venus": (250, 10),
               "proxima": (4000, 40), "tau_ceti": (5000, 50), "trappist": (6000, 60)}


def colony_cost(state: dict, body: str, c: dict) -> tuple[float, float]:
    base, years = COLONY_COST.get(body, (200, 10))
    # costs in billions of 2020 dollars; scale with how many techs have matured since
    n_space = sum(1 for t in c["techs"] if t in ("reusable_rockets", "orbital_infrastructure", "fusion_propulsion", "antimatter_production", "artificial_habitats"))
    return base * (0.85 ** n_space), max(2.0, years * (0.9 ** n_space))


def free_regions(state: dict, body: str) -> list[str]:
    return [pid for pid, p in state["provinces"].items() if p["body"] == body and p["owner"] is None]


def start_colony(state: dict, tag: str, pid: str, source: str = "ai") -> dict | None:
    from ..world.scenario import next_id
    c = state["countries"][tag]
    p = state["provinces"].get(pid)
    if not p or p["owner"] is not None:
        return None
    if any(pr["kind"] == "colonize" and pr["target"] == pid for x in state["countries"].values() for pr in x["projects"]):
        return None
    cost, years = colony_cost(state, p["body"], c)
    name = state["extra_geo"][pid]["name"]
    pr = {"id": next_id(state, "p"), "kind": "colonize", "name": f"Colonise {name}", "target": pid, "cost": cost, "years": years,
          "progress": 0.0, "started": state["meta"]["year"], "source": source, "desc": f"Establish a permanent settlement at {name} on {state['bodies'][p['body']]['name']}."}
    c["projects"].append(pr)
    return pr


def complete_colony(state: dict, c: dict, pid: str) -> None:
    p = state["provinces"][pid]
    if p["owner"] is not None:
        emit(state, "space", f"Colony expedition to {state['extra_geo'][pid]['name']} arrives too late",
             f"The expedition from {c['name']} found the site already claimed.", [c["tag"]], 2)
        return
    year = state["meta"]["year"]
    p.update(owner=c["tag"], ctrl=c["tag"], pop=0.002, gpc=c.get("gpc", 20000) * 0.9, base=c.get("gpc", 20000) * 0.9 / max(1e-9, c["mods"]["prod"]),
             cores=[c["tag"]], integ=100.0, founded=year, unrest=0.0)
    build_index(state)
    body = state["bodies"][p["body"]]["name"]
    first = sum(1 for q in state["provinces"].values() if q["body"] == p["body"] and q["owner"]) == 1
    emit(state, "space", f"{c['name']} founds a settlement at {state['extra_geo'][pid]['name']}",
         f"The first permanent settlers of {c['name']} have landed at {state['extra_geo'][pid]['name']} on {body}." + (" It is the first human settlement on this world." if first else ""),
         [c["tag"]], 4 if first else 3, [pid], ["space", "colony"])
    if first:
        state["milestones"].append({"y": year, "title": f"First settlement on {body} ({c['name']})", "actors": [c["tag"]], "kind": "space"})


def space_tick(state: dict, dt: float) -> None:
    """Colonies drift toward their own identity; autonomy pressure grows with population and distance."""
    year = state["meta"]["year"]
    for pid, p in state["provinces"].items():
        if p["body"] == "earth" or not p["owner"]:
            continue
        c = state["countries"][p["owner"]]
        home = c.get("home", "earth")
        if p["body"] == home:
            continue
        age = year - (p.get("founded") or year)
        distance = {"luna": 0.4, "mars": 1.0, "belt": 1.0, "venus": 0.8, "jovian": 1.4, "saturnian": 1.5}.get(p["body"], 3.0)
        # settlers keep arriving from the home world
        from .economy import ref_pop
        cap = ref_pop(state, pid)
        inflow = min(max(0.0, cap - p["pop"]), 0.00004 * c["pop"] * dt)
        p["pop"] += inflow
        pressure = clamp(p["pop"] * 6, 0, 35) * distance + min(35, age * 0.4) * distance
        if c["policies"].get("colonial", "direct") == "autonomy":
            pressure *= 0.45
        if c["policies"].get("colonial") == "representation":
            pressure *= 0.65
        p["autonomy_desire"] = round(clamp(pressure, 0, 100), 1)
        if age > 40 and p["culture"] == p["body"] and p["integ"] > 60:
            p["integ"] = max(40.0, p["integ"] - dt * 0.3 * distance)


def project_tick(state: dict, dt: float) -> None:
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        for pr in list(c["projects"]):
            pay = pr["cost"] / max(0.25, pr["years"]) * dt
            c["treasury"] -= pay
            pr["progress"] = min(1.0, pr["progress"] + dt / max(0.25, pr["years"]))
            if pr["progress"] >= 1.0:
                c["projects"].remove(pr)
                finish_project(state, c, pr)


def finish_project(state: dict, c: dict, pr: dict) -> None:
    from .projects import complete_project
    if pr["kind"] == "colonize":
        complete_colony(state, c, pr["target"])
    else:
        complete_project(state, c, pr)
