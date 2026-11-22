"""Stability, unrest, integration, rebellions, revolutions and civil wars."""
from __future__ import annotations

from collections import defaultdict

from ..util import clamp
from ..world.geo import get_geo
from ..world.ideologies import get_ideology, invent_ideology
from .core import add_memory, at_war, build_index, emit, idx, land_power, stab_add


def stability_tick(state: dict, dt: float) -> None:
    provs = state["provinces"]
    o_idx = idx(state)["owned"]
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        mine = o_idx.get(t, [])
        if not mine:
            continue
        pop = sum(provs[p]["pop"] for p in mine) or 1e-6
        avg_unrest = sum(provs[p]["unrest"] * provs[p]["pop"] for p in mine) / pop
        noncore = sum(provs[p]["pop"] for p in mine if t not in provs[p]["cores"]) / pop
        fam = get_ideology(state, c["ideology"])["family"]
        target = 55 + c["mods"].get("stab", 0) + c["budget"].get("welfare", 0.03) * 150 + (c["legitimacy"] - 50) * 0.3
        target -= c.get("exhaustion", 0) * 0.3 + avg_unrest * 0.35 + noncore * 15
        if c["debt"] > c["gdp"]:
            target -= 10
        growth = (c["gdp"] - c.get("prev_gdp", c["gdp"])) / max(1e-6, c.get("prev_gdp", c["gdp"]) or 1)
        target += clamp(growth * 100, -15, 6)
        target -= c["flags"].get("digital_tension", 0) * 0.3 + c["flags"].get("ai_tension", 0) * 0.2 + c["flags"].get("bio_backlash", 0) * 0.4
        if fam in ("authoritarian", "socialist", "artificial", "collective"):
            target += 6
        if at_war(state, t) and c.get("war_support", 50) < 35:
            target -= 8
        for mod in list(c.get("temp_mods", [])):
            if mod["until"] < state["meta"]["year"]:
                c["temp_mods"].remove(mod)
            else:
                target += mod.get("stability", 0)
        c["stability"] = clamp(c["stability"] + (clamp(target, 0, 100) - c["stability"]) * min(1.0, 0.3 * dt), 0, 100)
        if not at_war(state, t):
            c["exhaustion"] = max(0.0, c.get("exhaustion", 0) - 12 * dt)
            c["war_support"] = clamp(c.get("war_support", 50) + (50 - c.get("war_support", 50)) * min(1, 0.2 * dt), 0, 100)
        c["legitimacy"] = clamp(c["legitimacy"] + (60 + (c["stability"] - 50) * 0.4 - c["legitimacy"]) * min(1, 0.1 * dt), 0, 100)
    # provinces
    alive_cultures = defaultdict(set)
    for t, c in state["countries"].items():
        if c["alive"]:
            alive_cultures[c["culture"]].add(t)
    for pid, p in provs.items():
        o = p["owner"]
        if not o:
            continue
        c = state["countries"][o]
        pol = c["policies"].get("integration", "assimilate")
        foreign = 0.0 if o in p["cores"] else 45 * (1 - p["integ"] / 100)
        if o not in p["cores"] and p["culture"] != c["culture"] and p["body"] == "earth":
            # modern mass nationalism makes foreign rule over other peoples ever harder to sustain
            yr = state["meta"]["year"]
            nat = clamp((yr - 1880) / 80, 0, 1) * 28
            foreign += nat * (0.6 if p["integ"] > 80 else 1.0)
        target = foreign + max(0.0, 45 - c["stability"]) * 0.6
        if p["ctrl"] != o:
            target += 25
        if p["body"] != "earth":
            target += p.get("autonomy_desire", 0) * 0.6
        target += c["flags"].get("digital_tension", 0) * 0.15
        if any(t != o and state["countries"][t]["alive"] and pid in state["countries"][t]["claims"] for t in p["cores"]):
            target += 8
        local_aut = p.get("autonomy", 0)
        if pol == "suppress":
            target -= 15
        elif pol == "autonomy" or local_aut:
            target -= 20
        if c["flags"].get("garrison"):
            target -= 10
        p["unrest"] = clamp(p["unrest"] + (clamp(target, 0, 100) - p["unrest"]) * min(1.0, 0.35 * dt), 0, 100)
        if o not in p["cores"]:
            rate = {"assimilate": 2.5, "autonomy": 1.2, "suppress": 1.6, "federal": 1.8}.get(pol, 2.0)
            if p["culture"] == c["culture"]:
                rate *= 2
            elif p["body"] == "earth":
                rate *= 0.35
            if o == state["meta"].get("player"):
                rate *= {"sandbox": 2.5, "easy": 1.4}.get(state["meta"].get("settings", {}).get("difficulty"), 1.0)
            p["integ"] = clamp(p["integ"] + dt * rate * (1 - p["unrest"] / 150), 0, 100)
            if p["integ"] >= 97 and (p["culture"] == c["culture"] or p["body"] != "earth" or pol == "assimilate" and p["integ"] >= 99.5):
                p["cores"].append(o)


def revolt_tick(state: dict, dt: float, rng) -> None:
    """Provinces with sustained high unrest attempt to break away."""
    provs = state["provinces"]
    groups: dict[tuple, list[str]] = defaultdict(list)
    for pid, p in provs.items():
        if p["owner"] and p["unrest"] > 68 and p["ctrl"] == p["owner"]:
            key = (p["owner"], p["code"] if p["body"] == "earth" else p["body"])
            groups[key].append(pid)
    player = state["meta"].get("player")
    for (owner, code), pids in groups.items():
        c = state["countries"][owner]
        if not c["alive"] or len(idx(state)["owned"].get(owner, [])) <= len(pids):
            continue
        avg = sum(provs[p]["unrest"] for p in pids) / len(pids)
        if rng.random() > dt * (avg - 60) / 80:
            continue
        if any(d.get("kind") == "secession" and d.get("owner") == owner and d.get("code") == code for d in state["decisions"]):
            continue
        from .successors import create_country, region_label
        base, _ = region_label(state, pids)
        if owner == player:
            from ..story.decisions import add_decision
            add_decision(state, "secession", f"{base} rises in revolt",
                         f"Sustained unrest (average {avg:.0f}%) in {base} has erupted into open rebellion. Local leaders demand independence from {c['name']}.",
                         [("crush", "Crush the rebellion", "Declare a war of suppression against the rebels."),
                          ("autonomy", "Offer broad autonomy", "Grant self-rule within the state: unrest falls sharply, integration slows."),
                          ("recognize", "Recognise independence", "Let them go peacefully: a new state is born.")],
                         data={"owner": owner, "code": code, "pids": pids}, owner=owner, code=code)
            continue
        new = create_country(state, pids, parent=owner, kind="independence", rng=rng,
                             origin=f"Born from a rebellion against {c['name']} in {state['meta']['year']}.")
        nc = state["countries"][new]
        ratio = land_power(c) / max(0.01, land_power(nc))
        if ratio > 4 and c["stability"] > 35 and c["leader"]["traits"]["agg"] > 0.35:
            from .war import start_war
            start_war(state, new, owner, "independence", call_allies=False)
            emit(state, "revolt", f"{nc['name']} declares independence", f"Rebels in {base} have proclaimed {nc['name']}. {c['name']} refuses to recognise the secession and sends in its armies.",
                 [new, owner], 4, pids[:8], ["revolt"])
        else:
            emit(state, "revolt", f"{nc['name']} wins independence", f"After a wave of unrest, {base} has broken away from {c['name']} as {nc['name']}. Too weak to resist, {c['name']} acquiesced.",
                 [new, owner], 4, pids[:8], ["revolt", "independence"])


REV_POOL_MODERN = ["liberal_democracy", "social_democracy", "communism", "fascism", "military_junta", "conservatism", "technocracy"]
REV_POOL_FUTURE = ["technocracy", "planetarism", "algorithmic_governance", "substrate_egalitarianism", "bio_conservatism", "corporatocracy", "liberal_democracy"]
REV_POOL_OLD = ["absolute_monarchy", "constitutional_monarchy", "theocracy", "city_state_republic", "tribal_confederation"]


def revolution_tick(state: dict, dt: float, rng) -> None:
    year = state["meta"]["year"]
    for t, c in list(state["countries"].items()):
        if not c["alive"] or c["stability"] > 18:
            continue
        if rng.random() > dt * 0.3:
            continue
        mine = idx(state)["owned"].get(t, [])
        fam = get_ideology(state, c["ideology"])["family"]
        if len(mine) >= 6 and rng.random() < 0.35:
            civil_war(state, t, rng)
            continue
        pool = REV_POOL_OLD if year < 1800 else REV_POOL_FUTURE if year > 2120 else REV_POOL_MODERN
        if rng.random() < (0.15 if year < 2050 else 0.35):
            ide = _invent_from_crisis(state, c, rng)
            new_ideo = ide["id"]
        else:
            new_ideo = rng.choice([i for i in pool if i != c["ideology"]])
        change_government(state, t, new_ideo, rng, reason="revolution")


def _invent_from_crisis(state: dict, c: dict, rng) -> dict:
    cur = get_ideology(state, c["ideology"])["axes"]
    axes = {k: clamp(-v * 0.6 + rng.uniform(-0.6, 0.6), -1, 1) for k, v in cur.items()}
    if c["flags"].get("dig_share", 0) > 0.2:
        axes["substrate"] = clamp(axes["substrate"] + 0.8, -1, 1)
    ctx = f"the revolutionary crisis in {c['name']} ({state['meta']['year']})"
    ide = invent_ideology(state, axes, ctx, c["tag"], state["meta"]["year"])
    emit(state, "ideology", f"A new ideology: {ide['name']}", f"Out of {ctx} a new political doctrine has emerged: {ide['name']}. {ide['desc']} Its supporters are {ide['supporters']}.",
         [c["tag"]], 4, tags=["ideology"], data={"ideology": ide["id"]})
    return ide


def change_government(state: dict, tag: str, ideology: str, rng, reason: str = "reform", gov: str | None = None,
                      leader_title: str | None = None, quiet: bool = False) -> None:
    from ..world.factory import make_leader
    from ..world.ideologies import FAMILY_GOV
    c = state["countries"][tag]
    old = get_ideology(state, c["ideology"])["name"]
    ide = get_ideology(state, ideology)
    c["ideology"] = ide["id"]
    c["gov"] = gov or FAMILY_GOV.get(ide["family"], c["gov"])
    if reason in ("revolution", "coup"):
        c["leader"] = make_leader(rng, c["culture"] if c["home"] == "earth" else c["home"], state["meta"]["year"], leader_title or "Leader of the Revolution")
        c["stability"] = 45.0
        c["legitimacy"] = 40.0
    if ide["family"] in ("monarchic", "imperial"):
        c["policies"]["succession"] = "hereditary"
    elif c["policies"].get("succession") == "hereditary":
        c["policies"]["succession"] = "elective"
    if not quiet:
        verb = {"revolution": "Revolution", "coup": "Coup", "reform": "Reform", "election": "New government"}.get(reason, "Change")
        emit(state, "government", f"{verb} in {c['name']}: {ide['name']}",
             f"{c['name']} has abandoned {old} for {ide['name']}. The state is now a {c['gov']} led by {c['leader']['name']}.",
             [tag], 4 if reason == "revolution" else 3, tags=["government", reason])


def civil_war(state: dict, tag: str, rng) -> None:
    from .successors import create_country
    from .war import start_war
    c = state["countries"][tag]
    provs = state["provinces"]
    mine = idx(state)["owned"].get(tag, [])
    geo = get_geo()
    cap = c["capital"]
    # rebels take the provinces farthest from the capital / least integrated
    def dist(p):
        if p in geo.provinces and cap in geo.provinces:
            return geo.distance(p, cap)
        return 5000.0
    ranked = sorted(mine, key=lambda p: -(dist(p) / 1000 + provs[p]["unrest"] / 30 + (100 - provs[p]["integ"]) / 40))
    reb = [p for p in ranked[: max(1, len(mine) * 2 // 5)] if p != cap]
    if not reb:
        return
    year = state["meta"]["year"]
    pool = REV_POOL_FUTURE if year > 2120 else REV_POOL_MODERN if year > 1800 else REV_POOL_OLD
    ideo = rng.choice([i for i in pool if i != c["ideology"]])
    new = create_country(state, reb, parent=tag, kind="rebel", ideology=ideo, rng=rng,
                         origin=f"Rebel government formed during the civil war in {c['name']} ({year}).")
    nc = state["countries"][new]
    nc["claims"].update({p: year for p in mine if p not in reb})
    nc["army"] = max(nc["army"], c["army"] * 0.45)
    c["army"] *= 0.6
    start_war(state, new, tag, "civil", call_allies=False)
    emit(state, "civil_war", f"Civil war in {c['name']}", f"{c['name']} has split. {nc['name']}, espousing {get_ideology(state, ideo)['name']}, controls {len(reb)} provinces and fights for control of the whole state.",
         [tag, new], 5 if c["pop"] > 30 else 4, reb[:10], ["civil_war"])
