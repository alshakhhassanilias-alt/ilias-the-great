import copy

from app.sim.core import build_index, idx, total_power
from app.sim.engine import advance, create_world, set_player
from app.sim.successors import collapse_country, create_country
from app.sim.war import start_war


def test_time_advancement_monthly_and_yearly(world_1936):
    s = world_1936
    r = advance(s, 1)
    assert (s["meta"]["year"], s["meta"]["month"]) == (1936, 4)
    r = advance(s, 120)
    assert s["meta"]["year"] == 1946
    assert r["ticks"] < 40, "long jumps use yearly ticks"
    assert s["pending_events"], "time produces history"


def test_economy_is_consistent(world_1936):
    s = world_1936
    advance(s, 24)
    for t in ("GER", "USA"):
        c = s["countries"][t]
        bio = sum(p["pop"] * p["gpc"] / 1000 for p in s["provinces"].values() if p["owner"] == t)
        assert abs(c["gdp_bio"] - bio) / bio < 1e-6
        assert abs(c["pop"] - sum(p["pop"] for p in s["provinces"].values() if p["owner"] == t)) < 1e-6


def test_growth_is_plausible():
    s = create_world("1936", 9, {})
    g0 = sum(c["gdp"] for c in s["countries"].values() if c["alive"])
    advance(s, 12 * 30)
    g1 = sum(c["gdp"] for c in s["countries"].values() if c["alive"])
    assert 1.6 < g1 / g0 < 8, "30 years of 2-6% growth"


def test_determinism():
    a = create_world("1936", 77, {})
    b = create_world("1936", 77, {})
    advance(a, 60)
    advance(b, 60)
    assert {t: round(c["gdp"], 6) for t, c in a["countries"].items()} == {t: round(c["gdp"], 6) for t, c in b["countries"].items()}


def test_war_conquers_weak_neighbour_and_transfers_territory(world_1936):
    s = world_1936
    s["countries"]["GER"]["army"] *= 4
    start_war(s, "GER", "AUT", "conquest")
    owned_before = len(idx(s)["owned"]["GER"])
    advance(s, 24)
    assert not s["countries"]["AUT"]["alive"] or any(p["owner"] == "GER" and p["code"] == "AUT" for p in s["provinces"].values())
    assert len(idx(s)["owned"]["GER"]) > owned_before
    aut_mem = [m for m in s["countries"]["AUT"]["memories"] if m["other"] == "GER" and m["kind"] in ("invasion", "defeat", "territory_lost")]
    assert aut_mem, "the defeated remember"


def test_alliances_pull_allies_into_war(world_1936):
    w = start_war(world_1936, "GER", "CZS", "conquest")
    assert "FRA" in w["def"], "Franco-Czechoslovak alliance triggers"


def test_successor_states_and_collapse(world_1936):
    s = world_1936
    n = len([c for c in s["countries"].values() if c["alive"]])
    made = collapse_country(s, "GBR", "dismantle")
    assert len(made) > 10
    assert len([c for c in s["countries"].values() if c["alive"]]) == n + len(made)
    india = [t for t in made if s["countries"][t]["name"].lower().find("india") >= 0]
    assert india
    c = s["countries"][india[0]]
    assert "GBR" in c["predecessors"] and c["heritage"]
    assert s["countries"]["GBR"]["alive"], "the metropole survives a deliberate dismantling"


def test_restoration_of_fallen_state(world_1936):
    s = world_1936
    from app.sim.war import transfer_province, destroy_country
    pids = list(idx(s)["owned"]["AUT"])
    for p in pids:
        transfer_province(s, p, "GER", "conquest")
    build_index(s)
    destroy_country(s, "AUT", "GER", "test")
    s["meta"]["year"] += 20
    tag = create_country(s, pids, parent="GER", kind="independence")
    assert tag == "AUT" and s["countries"]["AUT"]["alive"] and s["countries"]["AUT"]["restored"] == s["meta"]["year"]


def test_technology_progression_and_infinite_tree():
    from app.sim.economy import grant_tech
    from app.world.techtree import TECHS, available, ensure_frontier
    s = create_world("2026", 2, {})
    c = s["countries"]["USA"]
    t0 = len(c["techs"])
    advance(s, 12 * 15)
    assert len(c["techs"]) > t0
    for t in TECHS:
        grant_tech(s, c, t, 0.5, quiet=True)
    ensure_frontier(s, set(c["techs"]))
    av = available(s, set(c["techs"]))
    assert av and all(t.get("generated") for t in av), "beyond the authored tree, new technologies are generated"


def test_space_colonisation_and_digital_population():
    from app.sim.economy import grant_tech
    from app.sim.space import project_tick, start_colony
    from app.sim.society import society_tick
    from app.world.techtree import TECHS
    s = create_world("2026", 4, {})
    c = s["countries"]["USA"]
    for t in ("mars_colonization", "digital_consciousness", "connectome_mapping"):
        for p in TECHS[t]["pre"]:
            grant_tech(s, c, p, 0.5, quiet=True)
        grant_tech(s, c, t, 0.0)
    assert "mars" in s["bodies"]
    mars = next(pid for pid, p in s["provinces"].items() if p["body"] == "mars")
    assert start_colony(s, "USA", mars)
    c["treasury"] = 1e6
    for _ in range(12):
        project_tick(s, 1.0)
    assert s["provinces"][mars]["owner"] == "USA"
    c["policies"]["upload"] = "mass"
    pop0 = c["pop"]
    society_tick(s, 1.0)
    assert c["pops"]["dig"] > 0 and c["pop"] < pop0 + 1e-9
