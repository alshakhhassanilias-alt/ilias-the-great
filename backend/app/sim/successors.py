"""Creation of new states: independence, successor states after collapse, restorations, rebels and colonies."""
from __future__ import annotations

import random
from collections import Counter

from ..util import clamp, rng_for
from ..world.factory import color_for, make_country, make_leader
from ..world.geo import get_geo
from ..world.ideologies import FAMILY_GOV, get_ideology
from ..world.names import adjective, state_name
from .core import add_memory, build_index, emit, idx
from .war import destroy_country, transfer_province


def _make_tag(state: dict, name: str) -> str:
    letters = [ch for ch in name.upper() if ch.isalpha()]
    base = "".join(letters[:3]) if len(letters) >= 3 else (name.upper() + "XXX")[:3]
    tag = base
    i = 1
    while tag in state["countries"]:
        tag = f"{base[:2]}{i}" if i < 10 else f"{base[0]}{i}"
        i += 1
    return tag


def region_label(state: dict, pids: list[str]) -> tuple[str, str]:
    """(base name, culture) for a group of provinces, from real geography or extraterrestrial regions."""
    geo = get_geo()
    provs = state["provinces"]
    codes = Counter(provs[p]["code"] for p in pids)
    code = codes.most_common(1)[0][0]
    culture = Counter(provs[p]["culture"] for p in pids).most_common(1)[0][0]
    if code in geo.countries:
        return geo.countries[code]["name"], culture
    body = provs[pids[0]]["body"]
    eg = state.get("extra_geo", {})
    if len(pids) == 1:
        return eg.get(pids[0], {}).get("name", body.title()), culture
    return state["bodies"].get(body, {}).get("name", body.title()).split(" (")[0], culture


def create_country(state: dict, pids: list[str], *, parent: str | None, kind: str, name: str | None = None,
                   ideology: str | None = None, overlord: str | None = None, origin: str | None = None,
                   rng: random.Random | None = None, transfer: bool = True) -> str:
    year = state["meta"]["year"]
    rng = rng or rng_for(state["meta"]["seed"], "newstate", year, len(state["countries"]))
    base, culture = region_label(state, pids)
    pc = state["countries"].get(parent) if parent else None
    body = state["provinces"][pids[0]]["body"]
    # restoration of a fallen state whose cores these are
    dead = Counter(t for p in pids for t in state["provinces"][p]["cores"] if t in state["countries"] and not state["countries"][t]["alive"])
    if dead and not name:
        tag, n = dead.most_common(1)[0]
        if n >= max(1, len(pids) // 2):
            return restore_country(state, tag, pids, parent, kind, rng)
    if not ideology:
        if body != "earth":
            ideology = rng.choice(["liberal_democracy", "technocracy", "substrate_egalitarianism", "social_democracy"])
        elif pc and kind == "decentralize":
            ideology = pc["ideology"]
        else:
            pool = ["liberal_democracy", "social_democracy", "conservatism", "military_junta", "technocracy"]
            if year < 1850:
                pool = ["absolute_monarchy", "constitutional_monarchy", "tribal_confederation", "city_state_republic"]
            elif year > 2100:
                pool += ["planetarism", "algorithmic_governance", "substrate_egalitarianism", "bio_conservatism"]
            ideology = rng.choice(pool)
    ide = get_ideology(state, ideology)
    if not name:
        if body != "earth":
            adj = {"mars": "Martian", "luna": "Lunar", "belt": "Belter", "venus": "Venusian", "jovian": "Jovian", "saturnian": "Saturnian"}.get(body, adjective(base))
            name = state_name(rng, ide["family"], base, adj)
        elif kind == "decentralize" and pc:
            name = f"Dominion of {base}"
        else:
            name = state_name(rng, ide["family"], base)
    adj = adjective(base) if body == "earth" else name.split()[0]
    tag = _make_tag(state, name)
    leader_culture = culture if body == "earth" else body
    leader = make_leader(rng, leader_culture, year, "Head of State")
    cap = max(pids, key=lambda p: state["provinces"][p]["pop"])
    c = make_country(tag, name, adj, color=color_for(rng), gov=FAMILY_GOV.get(ide["family"]), ideology=ideology, leader=leader,
                     capital=cap, culture=culture, year=year, techs=set(pc["techs"]) if pc else set(), stability=55,
                     home=body, ideology_reg=state["ideologies"])
    c["origin"] = origin or (f"Emerged in {year} from {pc['name']}." if pc else f"Founded in {year}.")
    c["predecessors"] = [parent] if parent else []
    c["overlord"] = overlord
    if pc:
        c["budget"] = dict(pc["budget"])
        c["policies"] = dict(pc["policies"])
        if pc["pop"] > 50 or "Empire" in pc["name"] or kind in ("successor", "decentralize"):
            c["heritage"].append({"name": pc["name"], "tag": parent, "rose": pc.get("founded"), "fell": pc.get("fell")})
    state["countries"][tag] = c
    pop_share = sum(state["provinces"][p]["pop"] for p in pids) / max(1e-6, pc["pop"]) if pc else 0
    for pid in pids:
        p = state["provinces"][pid]
        if transfer:
            transfer_province(state, pid, tag, "peaceful" if kind in ("decentralize", "successor", "grant") else "independence")
        if tag not in p["cores"]:
            p["cores"].append(tag)
        p["integ"] = 90.0
        p["unrest"] = clamp(p["unrest"] * 0.3, 0, 100)
    if pc:
        moved = pc["army"] * pop_share * 0.6
        pc["army"] -= moved
        c["army"] = max(5.0, moved)
        c["treasury"] = pc["treasury"] * pop_share * 0.5
        pc["treasury"] -= c["treasury"]
        # successors inherit their share of the public debt
        c["debt"] = pc["debt"] * min(1.0, pop_share)
        pc["debt"] -= c["debt"]
        if kind in ("independence", "rebel"):
            add_memory(state, tag, parent, "independence", -30, f"Won independence from {pc['name']} in {year}.")
            add_memory(state, parent, tag, "territory_lost", -25, f"Lost {base} to the breakaway {name} in {year}.")
        elif kind in ("grant", "decentralize", "successor"):
            add_memory(state, tag, parent, "cooperation", 15 if kind != "successor" else 5, f"Became self-governing as {pc['name']} devolved power in {year}.")
    build_index(state)
    from .economy import aggregate
    from .core import compute_mods
    compute_mods(state, c)
    aggregate(state)
    return tag


def restore_country(state: dict, tag: str, pids: list[str], parent: str | None, kind: str, rng) -> str:
    c = state["countries"][tag]
    year = state["meta"]["year"]
    pc = state["countries"].get(parent) if parent else None
    c["alive"] = True
    gone = year - (c.get("fell") or year)
    c["restored"] = year
    c["fell"] = None
    c["leader"] = make_leader(rng, c["culture"], year, c["leader"]["title"])
    if pc:
        c["techs"] = sorted(set(c["techs"]) | set(pc["techs"]))
        c["predecessors"] = list(dict.fromkeys(c.get("predecessors", []) + [parent]))
    for pid in pids:
        transfer_province(state, pid, tag, "independence")
        state["provinces"][pid]["integ"] = 95.0
    cap = c["capital"] if c["capital"] in pids else max(pids, key=lambda p: state["provinces"][p]["pop"])
    c["capital"] = cap
    c["army"] = max(5.0, c["army"] * 0.2)
    c["stability"] = 60.0
    if gone >= 1:
        c["origin"] = (c.get("origin") or "") + f" Restored in {year} after {gone} years of foreign rule" + (f" by {pc['name']}." if pc else ".")
    if pc and (pc["pop"] > 50 or kind in ("successor", "grant", "decentralize")) and not any(h.get("tag") == parent for h in c["heritage"]):
        c["heritage"].append({"name": pc["name"], "tag": parent, "rose": pc.get("founded"), "fell": pc.get("fell")})
    if pc:
        add_memory(state, tag, parent, "independence", -35, f"Regained independence from {pc['name']} in {year}, {gone} years after its fall.")
    build_index(state)
    emit(state, "restoration", f"{c['name']} is restored", f"After {gone} years, {c['name']} has re-emerged as an independent state, claiming continuity with its pre-{c.get('fell_year', '')} institutions.".replace("pre- ", ""),
         [tag] + ([parent] if parent else []), 4, pids[:10], ["restoration"])
    from .economy import aggregate
    from .core import compute_mods
    compute_mods(state, c)
    aggregate(state)
    return tag


def group_provinces(state: dict, pids: list[str], capital: str | None) -> list[list[str]]:
    """Cluster provinces into plausible successor units: by modern country code on Earth, by body elsewhere."""
    provs = state["provinces"]
    groups: dict[str, list[str]] = {}
    for pid in pids:
        p = provs[pid]
        key = p["code"] if p["body"] == "earth" else f"body:{p['body']}"
        groups.setdefault(key, []).append(pid)
    out = list(groups.values())
    # split very large earth groups (e.g. continental countries) roughly in two by longitude
    final = []
    geo = get_geo()
    for g in out:
        if len(g) > 18 and provs[g[0]]["body"] == "earth":
            g.sort(key=lambda p: geo.provinces[p]["c"][0])
            half = len(g) // 2
            final += [g[:half], g[half:]]
        else:
            final.append(g)
    return final


def collapse_country(state: dict, tag: str, mode: str = "collapse", rng=None, keep_core: bool = True) -> list[str]:
    """Break a state into successors. mode: collapse (violent fragmentation), dismantle (deliberate, peaceful),
    decentralize (self-governing dominions under the old crown)."""
    rng = rng or rng_for(state["meta"]["seed"], "collapse", tag, state["meta"]["year"])
    c = state["countries"][tag]
    year = state["meta"]["year"]
    mine = list(idx(state)["owned"].get(tag, []))
    if not mine:
        return []
    cap = c["capital"]
    groups = group_provinces(state, mine, cap)
    core_group = next((g for g in groups if cap in g), None) if keep_core else None
    created = []
    old_name = c["name"]
    for g in groups:
        if g is core_group:
            continue
        kind = {"collapse": "successor", "dismantle": "grant", "decentralize": "decentralize"}[mode]
        overlord = tag if mode == "decentralize" else None
        if mode == "collapse":
            origin = f"One of the successor states born from the collapse of {old_name} in {year}."
        elif mode == "dismantle":
            origin = f"Granted independence when {old_name} deliberately dismantled its empire in {year}."
        else:
            origin = f"A self-governing dominion created when {old_name} decentralised in {year}."
        nt = create_country(state, g, parent=tag, kind=kind, overlord=overlord, origin=origin, rng=rng)
        created.append(nt)
        if mode == "collapse":
            nc = state["countries"][nt]
            # successors claim the imperial legacy: restorationists covet the old heartland
            if rng.random() < 0.35:
                for pid in mine:
                    if state["provinces"][pid]["owner"] != nt and rng.random() < 0.3:
                        nc["claims"][pid] = year
                nc["ambitions"].append(f"Restore the unity of the former {old_name} under {nc['name']}'s leadership")
    if not keep_core or core_group is None:
        destroy_country(state, tag, None, f"{old_name} dissolved.")
    else:
        c["stability"] = 45.0 if mode == "collapse" else 60.0
    build_index(state)
    return created
