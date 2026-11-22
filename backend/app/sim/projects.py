"""National projects and initiatives with costs, durations and validated effects."""
from __future__ import annotations

from ..util import clamp
from .core import add_memory, compute_mods, emit, stab_add

ALLOWED_EFFECTS = {"stability": (-30, 30), "prod": (-0.2, 0.4), "research": (-0.2, 0.5), "legitimacy": (-30, 30),
                   "integration": (-30, 40), "unrest": (-40, 40), "military": (-0.3, 0.5), "war_support": (-30, 30),
                   "terraform": (0, 0.2), "dig_share": (0, 0.5), "infra": (0, 0.3), "opinion_world": (-30, 30)}


def sanitize_effects(eff: dict) -> dict:
    out = {}
    for k, v in (eff or {}).items():
        if k in ALLOWED_EFFECTS:
            lo, hi = ALLOWED_EFFECTS[k]
            try:
                out[k] = clamp(float(v), lo, hi)
            except (TypeError, ValueError):
                continue
    return out


def new_project(state: dict, c: dict, kind: str, name: str, cost: float, years: float, effects: dict, desc: str,
                target: str | None = None, source: str = "player") -> dict:
    from ..world.scenario import next_id
    pr = {"id": next_id(state, "p"), "kind": kind, "name": name, "target": target, "cost": max(0.0, cost),
          "years": max(0.25, years), "progress": 0.0, "started": state["meta"]["year"], "effects": sanitize_effects(effects),
          "desc": desc, "source": source}
    c["projects"].append(pr)
    return pr


def complete_project(state: dict, c: dict, pr: dict) -> None:
    eff = pr.get("effects", {})
    year = state["meta"]["year"]
    if "stability" in eff:
        stab_add(c, eff["stability"])
    if "legitimacy" in eff:
        c["legitimacy"] = clamp(c["legitimacy"] + eff["legitimacy"], 0, 100)
    if "war_support" in eff:
        c["war_support"] = clamp(c.get("war_support", 50) + eff["war_support"], 0, 100)
    perm = {k: eff[k] for k in ("prod", "research") if k in eff}
    if "military" in eff:
        c["mil_bonus"] = c.get("mil_bonus", 0) + eff["military"]
    if perm:
        c["laws"].append({"name": pr["name"], "text": pr["desc"], "year": year, "eff": perm, "kind": "project"})
        compute_mods(state, c)
    if "integration" in eff or "unrest" in eff or "infra" in eff:
        for pid, p in state["provinces"].items():
            if p["owner"] == c["tag"]:
                p["integ"] = clamp(p["integ"] + eff.get("integration", 0), 0, 100)
                p["unrest"] = clamp(p["unrest"] + eff.get("unrest", 0), 0, 100)
                p["dev"] = clamp(p["dev"] + eff.get("infra", 0), 0.5, 1.6)
    if "terraform" in eff and pr.get("target") in state["bodies"]:
        b = state["bodies"][pr["target"]]
        b["terraform"] = clamp(b.get("terraform", 0) + eff["terraform"], 0, 1)
    if "dig_share" in eff:
        from .society import upload_population
        upload_population(state, c, eff["dig_share"])
    if "opinion_world" in eff:
        from .relations import modify
        for t, x in state["countries"].items():
            if x["alive"] and t != c["tag"]:
                modify(state, t, c["tag"], eff["opinion_world"] * 0.5)
    pd = c["flags"].setdefault("projects_done", {})
    pd[pr["kind"]] = pd.get(pr["kind"], 0) + 1
    imp = 3 if pr.get("source") == "player" else 2
    emit(state, "project", f"{c['name']} completes: {pr['name']}", f"{pr['desc']} The project, begun in {pr['started']}, is complete.",
         [c["tag"]], imp, tags=["project", pr["kind"]], data={"project": pr["kind"]})
