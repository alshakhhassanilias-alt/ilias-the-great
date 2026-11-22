from app.sim.engine import create_world
from app.world.geo import get_geo
from app.world.scenario import list_scenarios


def test_geography_loaded():
    g = get_geo()
    assert len(g.provinces) > 1300
    p = next(iter(g.provinces.values()))
    assert {"id", "name", "c", "nb", "w"} <= set(p)
    assert any(pid for pid, x in g.provinces.items() if x["name"] == "Berlin")


def test_all_historical_scenarios_build():
    for sc in list_scenarios():
        if sc["kind"] != "historical":
            continue
        s = create_world(sc["id"], 1, {})
        alive = [c for c in s["countries"].values() if c["alive"]]
        assert len(alive) > 30, sc["id"]
        owned = sum(1 for p in s["provinces"].values() if p["owner"])
        assert owned > 1300
        for c in alive:
            assert c["gdp"] > 0 and c["pop"] > 0, c["tag"]
            assert c["leader"]["name"]


def test_1936_historical_facts():
    s = create_world("1936", 1, {})
    c = s["countries"]
    assert c["GER"]["leader"]["name"] == "Adolf Hitler"
    assert c["SOV"]["ideology"] == "communism"
    assert c["MAN"]["overlord"] == "JPN"
    geo = get_geo()
    india = [pid for pid in geo.by_modern["IND"]]
    assert all(s["provinces"][p]["owner"] == "GBR" for p in india)
    assert any(w["name"] == "Second Italo-Ethiopian War" for w in s["wars"])
    assert any(m["kind"] == "treaty_imposed" for m in c["GER"]["memories"]), "national memory of Versailles"
    assert c["USA"]["gdp"] > c["GER"]["gdp"] > c["ITA"]["gdp"]


def test_2026_is_modern_world():
    s = create_world("2026", 1, {})
    assert len([c for c in s["countries"].values() if c["alive"]]) > 180
    assert "internet" in s["countries"]["USA"]["techs"]
    assert any(w["name"] == "Russo-Ukrainian War" for w in s["wars"])


def test_fictional_worlds_any_year():
    for year in (-800, 1200, 2400):
        s = create_world("fictional", 3, {}, year)
        assert s["meta"]["year"] == year
        alive = [c for c in s["countries"].values() if c["alive"]]
        assert 25 <= len(alive) <= 120
        assert s["meta"]["backstory_events"], "fictional worlds get a generated history"
        assert s["meta"]["fallen_empires"][0]["fell"] < year
        assert any(c["heritage"] for c in alive)
    ancient = create_world("fictional", 3, {}, -800)
    assert "industrialization" not in ancient["countries"][next(iter(ancient["countries"]))]["techs"]


def test_country_creation_and_scenario_listing():
    from app import service
    rows = service.scenario_countries("1936")
    assert rows[0]["power"] >= rows[-1]["power"]
    assert any(r["tag"] == "GER" for r in rows)
