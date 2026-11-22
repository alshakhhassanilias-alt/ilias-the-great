"""Deterministic economy: provincial productivity, population, budgets, research and force generation."""
from __future__ import annotations

import math

from ..util import clamp
from ..world.geo import BODIES, get_geo
from ..world.techtree import all_techs, ensure_frontier, available
from .core import at_war, compute_mods, emit, idx

COLONY_CAP = {"luna": 1.5, "mars": 25.0, "belt": 2.0, "jovian": 3.0, "saturnian": 3.0, "venus": 6.0, "proxima": 60.0, "tau_ceti": 60.0, "trappist": 40.0}


RP_K = 1.0       # research points per $bn of research spending (calibrated)
COST_T9 = 24.0     # cost of a tier-9 technology (the 1930s frontier)
GROWTH_PRE = 1.8   # cost multiplier per tier before the modern era
GROWTH_MOD = 2.1   # cost multiplier per tier from the modern era onward


def base_cost(tier: int) -> float:
    if tier < 9:
        return COST_T9 * (GROWTH_PRE ** (tier - 9))
    return COST_T9 * (GROWTH_MOD ** (tier - 9))


def tech_cost_for(state: dict, tech: dict, world_share: float) -> float:
    base = base_cost(tech["tier"])
    return base * (1 - 0.7 * world_share)


def ref_pop(state: dict, pid: str) -> float:
    geo = get_geo()
    p = geo.provinces.get(pid)
    if p:
        return geo.countries.get(p["country"], {}).get("pop", 1e5) / 1e6 * p["w"]
    body = state["provinces"][pid]["body"]
    cap = COLONY_CAP.get(body, 2.0)
    terra = state["bodies"].get(body, {}).get("terraform", 0.0)
    return cap * (1 + 3 * terra)


def init_economy(state: dict) -> None:
    """Derive base productivity so that current GDP per capita is reproduced with current technology."""
    for c in state["countries"].values():
        compute_mods(state, c)
    for pid, p in state["provinces"].items():
        if p["owner"]:
            m = state["countries"][p["owner"]]["mods"]["prod"]
            p["base"] = p["gpc"] / m
    aggregate(state)
    for c in state["countries"].values():
        c["treasury"] = c["gdp"] * 0.03
        c["prev_gdp"] = c["gdp"]
        c["rp_rate"] = rp_rate(c)


def aggregate(state: dict) -> None:
    for c in state["countries"].values():
        c["pop"] = 0.0
        c["gdp"] = 0.0
    for p in state["provinces"].values():
        o = p["owner"]
        if o:
            c = state["countries"][o]
            c["pop"] += p["pop"]
            c["gdp"] += p["pop"] * p["gpc"] / 1000.0
    for c in state["countries"].values():
        if not c["alive"]:
            continue
        gpc = c["gdp"] * 1000 / c["pop"] if c["pop"] > 0 else 20000
        c["gdp_bio"] = c["gdp"]
        dig = c["pops"].get("dig", 0.0)
        ai = c["pops"].get("ai", 0.0)
        if dig:
            # uploaded citizens work and consume like everyone else (bounded by their number, no feedback loop)
            c["gdp"] += dig * min(gpc, 2e6) * 1.2 / 1000.0
        if ai:
            # artificial persons raise productivity, with saturating returns
            c["gdp"] += c["gdp_bio"] * 0.6 * ai / (ai + max(1e-6, c["pop"]))
        c["gpc"] = gpc


def economy_tick(state: dict, dt: float) -> None:
    provs = state["provinces"]
    countries = state["countries"]
    for c in countries.values():
        if c["alive"]:
            compute_mods(state, c)
    # frontier institutional quality: the best-run large economies
    bases = sorted((p["base"] for p in provs.values() if p["owner"] and p["pop"] > 1), reverse=True)
    frontier = bases[len(bases) // 20] if bases else 1000
    core_base: dict[str, list[float]] = {}
    for p in provs.values():
        if p["owner"] and p["owner"] in p["cores"]:
            acc = core_base.setdefault(p["owner"], [0.0, 0.0])
            acc[0] += p["base"] * p["pop"]
            acc[1] += p["pop"]
    avg_base = {t: (a / b if b else 0) for t, (a, b) in core_base.items()}
    warring = {t for w in state["wars"] for t in w["att"] + w["def"]}
    for pid, p in provs.items():
        o = p["owner"]
        if not o:
            continue
        c = countries[o]
        m = c["mods"]
        eff = (0.75 + 0.005 * c["stability"]) * (1 - p["unrest"] * 0.004) * (0.7 + 0.003 * p["integ"])
        if p["ctrl"] != o:
            eff *= 0.6
        pol = c["policies"].get("economy", "mixed")
        eff *= {"planned": 0.95, "market": 1.04, "mixed": 1.0, "autarky": 0.9, "post_scarcity": 1.1}.get(pol, 1.0)
        if c["debt"] > c["gdp"] * 1.2:
            eff *= 0.92
        # baseline productivity growth from capital accumulation and incremental innovation; it tapers as societies get richer
        if "industrialization" in c["techs"]:
            g0 = 0.0095 / (1 + p["gpc"] / 150000.0) * (0.5 + c["stability"] / 100) * (0.4 if p["ctrl"] != o else 1.0)
        else:
            g0 = 0.0015
        p["base"] *= math.exp(g0 * dt)
        target = p["base"] * m["prod"] * eff * p["dev"]
        p["gpc"] += (target - p["gpc"]) * min(1.0, 0.3 * dt)
        if not (p["gpc"] == p["gpc"]) or p["gpc"] > 5e7:
            p["gpc"] = min(5e7, target if target == target else 1000.0)
        # institutional convergence toward the national core and the world frontier
        infra = c["budget"].get("infra", 0.02)
        ab = avg_base.get(o, p["base"])
        if ab > p["base"]:
            p["base"] += (ab - p["base"]) * dt * (0.004 + 0.4 * infra) * (p["integ"] / 100)
        if frontier > p["base"]:
            p["base"] += (frontier - p["base"]) * dt * (0.0005 + 0.05 * infra) * (c["stability"] / 100)
        p["dev"] = clamp(p["dev"] + dt * (infra * 0.4 * (1.5 - p["dev"]) - (0.05 if p["ctrl"] != o else 0)), 0.5, 1.5)
        # population
        if p["body"] == "earth":
            K = max(ref_pop(state, pid) * 1.5, 0.0005)
        else:
            K = ref_pop(state, pid)
        if "industrialization" not in c["techs"]:
            r = 0.003 + m["pop"] * 0.5
        else:
            r = 0.004 + 0.022 * clamp(1 - p["gpc"] / 35000, 0, 1) * (1.0 if "antibiotics" in c["techs"] else 0.5) + m["pop"] * 0.3
        if p["body"] != "earth":
            r = 0.06 * BODIES.get(p["body"], {}).get("habitability", 0.1) * 4 + 0.02
        r *= (1 - p["pop"] / K) if K > 0 else 0
        if p["ctrl"] != o:
            r -= 0.012
        if p["unrest"] > 70:
            r -= 0.004
        if o in warring:
            r -= 0.002
        p["pop"] = min(max(0.0, p["pop"] * math.exp(clamp(r, -0.5, 0.5) * dt)), 1e5)
    aggregate(state)
    # budgets
    for t, c in countries.items():
        if not c["alive"]:
            continue
        b = c["budget"]
        mil = effective_military(state, c)
        spend = mil + b.get("research", 0) + b.get("infra", 0) + b.get("welfare", 0) + 0.08
        income = 0.20 if c["policies"].get("economy") != "planned" else 0.24
        bal = (income - spend) * c["gdp"] - c["debt"] * 0.03
        c["treasury"] += bal * dt
        if c["treasury"] < 0:
            c["debt"] += -c["treasury"]
            c["treasury"] = 0.0
        if c["debt"] > c["gdp"] * 2.5 and c["gdp"] > 0:
            # sovereign default: creditors take a haircut, the state pays in stability and credibility
            c["debt"] = c["gdp"] * 0.4
            c["stability"] = max(0.0, c["stability"] - 18)
            c["legitimacy"] = max(0.0, c["legitimacy"] - 15)
            c.setdefault("temp_mods", []).append({"until": state["meta"]["year"] + 3, "stability": -6})
            for pid in idx(state)["owned"].get(t, []):
                state["provinces"][pid]["gpc"] *= 0.94
            from .core import emit
            emit(state, "economy", f"{c['name']} defaults on its debt", f"Unable to service debts of more than two and a half times its annual output, {c['name']} has defaulted. Creditors accept steep losses; savings are wiped out and the government's authority is shaken.",
                 [t], 4 if t == state["meta"].get("player") else 3, tags=["economy", "default"])
        elif c["debt"] > 0 and c["treasury"] > c["gdp"] * 0.05:
            pay = min(c["debt"], c["treasury"] - c["gdp"] * 0.05)
            c["debt"] -= pay
            c["treasury"] -= pay


def effective_military(state: dict, c: dict) -> float:
    mil = c["budget"].get("military", 0.03)
    if at_war(state, c["tag"]):
        mob = c["policies"].get("mobilization", "partial")
        mil = max(mil, {"none": mil, "partial": 0.15, "total": 0.35}.get(mob, 0.15))
    return mil


def military_tick(state: dict, dt: float) -> None:
    for t, c in state["countries"].items():
        if not c["alive"] or c["pop"] <= 0:
            continue
        spend = c["gdp"] * effective_military(state, c)
        gpc = max(500.0, c.get("gpc", 5000))
        wage = (gpc / 8500) ** 0.85
        mix = c["mil_mix"]
        war = any(t in w["att"] or t in w["def"] for w in state["wars"])
        cap = c["pop"] * 1000 * (0.10 if war else 0.02) + 5
        tgt_army = min(cap, spend * mix.get("army", 0.55) / (0.035 * wage))
        tgt_navy = spend * mix.get("navy", 0.25) / (0.02 * wage)
        tgt_air = spend * mix.get("air", 0.2) / (0.003 * wage)
        space_share = mix.get("space", 0.0) if "space_military" in c["mods"].get("unlocks", []) else 0.0
        tgt_space = spend * space_share / (0.4 * wage)
        for key, tgt in (("army", tgt_army), ("navy", tgt_navy), ("air", tgt_air), ("space", tgt_space)):
            cur = c.get(key, 0.0)
            rate = (0.8 if war else 0.3) if tgt > cur else 0.2
            c[key] = max(0.0, cur + (tgt - cur) * min(1.0, rate * dt))
        if "nukes" in c["mods"].get("unlocks", []) and c["budget"].get("military", 0) > 0.03:
            c["nukes"] = int(c.get("nukes", 0) + dt * min(200, c["gdp"] / 200))


def research_tick(state: dict, dt: float, rng, choose) -> list[tuple[str, str]]:
    """Advance research for all countries. `choose(state, c)` picks a target for countries without one."""
    countries = state["countries"]
    at = all_techs(state)
    world_gdp = sum(c["gdp"] for c in countries.values() if c["alive"]) or 1
    known_share: dict[str, float] = {}
    for c in countries.values():
        if c["alive"]:
            for tid in c["techs"]:
                known_share[tid] = known_share.get(tid, 0) + c["gdp"] / world_gdp
    done = []
    for t, c in countries.items():
        if not c["alive"]:
            continue
        known = set(c["techs"])
        ensure_frontier(state, known)
        at = all_techs(state)
        r = c["research"]
        if not r.get("target") or r["target"] in known or r["target"] not in at or not all(p in known for p in at[r["target"]]["pre"]):
            r["target"] = choose(state, c)
            r["progress"] = r.get("progress", 0.0) if r.get("target") else 0.0
        rp = rp_rate(c) * dt
        c["rp_rate"] = rp_rate(c)
        if r["target"]:
            tech = at[r["target"]]
            cost = tech_cost_for(state, tech, known_share.get(tech["id"], 0))
            r["progress"] += rp
            r["cost"] = cost
            if r["progress"] >= cost:
                r["progress"] -= cost
                r["progress"] = min(r["progress"], cost * 0.5)
                grant_tech(state, c, tech["id"], known_share.get(tech["id"], 0))
                done.append((t, tech["id"]))
                r["target"] = choose(state, c)
        # technology diffusion: laggards adopt widely known techs
        for tech in available(state, set(c["techs"])):
            s = known_share.get(tech["id"], 0)
            if s > 0.4 and rng.random() < dt * 0.12 * s * (0.3 + 0.7 * min(1, c.get("gpc", 1000) / 15000)):
                grant_tech(state, c, tech["id"], s, quiet=True)
    return done


def rp_rate(c: dict) -> float:
    return c["gdp"] * c["budget"].get("research", 0.01) * c.get("mods", {}).get("research", 1.0) * RP_K * (0.6 + 0.008 * c["stability"])


def grant_tech(state: dict, c: dict, tid: str, share: float = 0.0, quiet: bool = False) -> None:
    if tid in c["techs"]:
        return
    at = all_techs(state)
    tech = at[tid]
    c["techs"].append(tid)
    compute_mods(state, c)
    first = share <= 0.0001
    disc = state.setdefault("discoveries", {})
    if tid not in disc:
        disc[tid] = {"by": c["tag"], "year": state["meta"]["year"]}
        if tech.get("generated"):
            tech["first_by"] = c["tag"]
            tech["first_year"] = state["meta"]["year"]
    if quiet and not first:
        return
    player = state["meta"].get("player")
    imp = 2
    if first:
        imp = 4 if tech["tier"] >= 17 or tech["eff"].get("unlock") else 3
    if c["tag"] == player:
        imp = max(imp, 3)
    if first or c["tag"] == player:
        title = f"{'World first: ' if first else ''}{c['name']} achieves {tech['name']}"
        body = f"Scientists of {c['name']} have mastered {tech['name']}: {tech['desc']}"
        if first:
            body += " No nation has achieved this before."
        emit(state, "science", title, body, [c["tag"]], imp, tags=["tech", tech["cat"]], data={"tech": tid, "first": first})
        if first:
            state["milestones"].append({"y": state["meta"]["year"], "title": f"{tech['name']} ({c['name']})", "actors": [c["tag"]], "kind": "tech"})
    from .space import on_unlock
    for u in tech["eff"].get("unlock", []):
        on_unlock(state, c, u)


def years_for(cost: float, rp: float, growth: float = 0.035) -> float:
    """Years to accumulate `cost` research points starting at `rp`/year with growing research output."""
    rp = max(rp, 1e-9)
    return math.log(1 + growth * cost / rp) / growth
