"""The simulation engine: initialises campaigns and advances time deterministically."""
from __future__ import annotations

import time

from ..util import rng_for
from ..world.scenario import SCENARIOS, build_fictional, build_historical
from . import ai as ai_mod
from .core import build_index, compute_mods
from .economy import aggregate, economy_tick, init_economy, military_tick, research_tick
from .leaders import leaders_tick
from .relations import decay_mods, recompute_opinions
from .society import society_tick
from .space import project_tick, space_tick
from .stability import revolt_tick, revolution_tick, stability_tick
from .war import war_tick


def create_world(scenario: str, seed: int, settings: dict, year: int | None = None) -> dict:
    if scenario == "fictional":
        state = build_fictional(seed, int(year if year is not None else 1500), settings)
    else:
        state = build_historical(scenario, seed, settings)
    build_index(state)
    init_economy(state)
    for c in state["countries"].values():
        compute_mods(state, c)
        c["research"]["target"] = ai_mod.choose_research(state, c)
    recompute_opinions(state)
    from ..story.director import political_period, world_era
    state["meta"]["era"] = world_era(state)
    state["meta"]["era_since"] = state["meta"]["year"]
    state["meta"]["period"] = political_period(state)
    return state


def set_player(state: dict, tag: str) -> None:
    from ..story.director import detect_phase
    from ..story.missions import generate_missions
    old = state["meta"].get("player")
    if old and old in state["countries"]:
        state["countries"][old]["ai"] = True
    state["meta"]["player"] = tag
    c = state["countries"][tag]
    c["ai"] = False
    c["policies"].setdefault("auto_research", True)
    ph = detect_phase(state, tag)
    state["meta"]["phase"] = ph["id"]
    state["meta"]["phase_label"] = ph["label"]
    state["meta"]["phase_metrics"] = ph["metrics"]
    state["meta"]["phase_since"] = state["meta"]["year"]
    for m in state["missions"].values():
        if m["status"] == "active":
            m["status"] = "superseded"
            m["note"] = "The player now leads a different state."
    generate_missions(state, tag)


def _choose(state: dict, c: dict):
    if not c.get("ai", True) and not c["policies"].get("auto_research", True):
        return c["research"].get("queue", [None])[0] if c["research"].get("queue") else None
    q = c["research"].get("queue") or []
    while q and q[0] in c["techs"]:
        q.pop(0)
    if q:
        from ..world.techtree import all_techs
        t = all_techs(state).get(q[0])
        if t and all(p in c["techs"] for p in t["pre"]):
            return q[0]
    return ai_mod.choose_research(state, c)


def advance(state: dict, months: int, on_year=None, budget_s: float = 120.0) -> dict:
    """Advance the simulation. Monthly ticks for short horizons, yearly ticks for long jumps."""
    from ..story.decisions import expire_decisions
    from ..story.director import director_tick
    from ..story.hooks import hooks_tick
    from ..story.missions import check_missions, generate_missions
    from ..story.threads import prune_threads
    meta = state["meta"]
    player = meta.get("player")
    t0 = time.time()
    remaining = months
    ticks = 0
    years_crossed = 0
    stop_reason = None
    while remaining > 0:
        if remaining >= 12 and meta["month"] == 1 and months > 24:
            dt_m = 12
        else:
            dt_m = 1
        dt = dt_m / 12
        meta["dt"] = dt
        rng = rng_for(meta["seed"], "tick", meta["year"], meta["month"])
        # advance the calendar
        meta["month"] += dt_m
        while meta["month"] > 12:
            meta["month"] -= 12
            meta["year"] += 1
        new_year = dt_m == 12 or meta["month"] == 1
        meta["tick"] += 1
        build_index(state)
        for c in state["countries"].values():
            if new_year and c["alive"]:
                c["prev_gdp"] = c["gdp"]
        economy_tick(state, dt)
        research_tick(state, dt, rng, _choose)
        military_tick(state, dt)
        war_tick(state, dt, rng)
        build_index(state)
        stability_tick(state, dt)
        project_tick(state, dt)
        space_tick(state, dt)
        society_tick(state, dt)
        hooks_tick(state, rng)
        ai_mod.ai_tick(state, dt, rng)
        decay_mods(state, dt)
        if new_year:
            years_crossed += 1
            revolt_tick(state, 1.0 if dt_m == 12 else 1.0, rng)
            revolution_tick(state, 1.0, rng)
            leaders_tick(state, 1.0, rng)
            build_index(state)
            aggregate(state)
            recompute_opinions(state)
            director_tick(state, rng)
            _record_history(state)
            if player:
                check_missions(state, player, rng)
                generate_missions(state, player)
            prune_threads(state)
            if on_year:
                on_year(state)
        elif player:
            check_missions(state, player, rng)
        expire_decisions(state, rng)
        remaining -= dt_m
        ticks += 1
        # stop early when the player must make a decision or the player's state has fallen
        if player and not state["countries"][player]["alive"]:
            stop_reason = "fallen"
            break
        if player and any(d.get("owner") == player and d["year"] * 12 + d["month"] >= (meta["year"] * 12 + meta["month"] - dt_m) for d in state["decisions"]) and state["meta"]["settings"].get("pause_on_decision", True):
            stop_reason = "decision"
            break
        if time.time() - t0 > budget_s:
            stop_reason = "time_budget"
            break
    build_index(state)
    aggregate(state)
    return {"ticks": ticks, "years": years_crossed, "stopped": stop_reason, "elapsed": round(time.time() - t0, 2)}


def _record_history(state: dict) -> None:
    """Yearly statistics for charts and for the historical record."""
    hist = state.setdefault("history", {})
    year = state["meta"]["year"]
    player = state["meta"].get("player")
    from .core import total_power
    ranked = sorted((c for c in state["countries"].values() if c["alive"]), key=lambda c: -c["gdp"])[:8]
    tags = {c["tag"] for c in ranked}
    if player:
        tags.add(player)
    stride = 1 if year - state["meta"]["start_year"] < 200 else 5
    if (year - state["meta"]["start_year"]) % stride:
        return
    for t in tags:
        c = state["countries"][t]
        if not c["alive"]:
            continue
        h = hist.setdefault(t, [])
        h.append([year, round(c["gdp"], 2), round(c["pop"], 3), round(total_power(c), 2), round(c["stability"], 1),
                  round(c["pops"].get("dig", 0), 3), len([1 for p in state["provinces"].values() if p["owner"] == t])])
        if len(h) > 600:
            del h[: len(h) - 600]
