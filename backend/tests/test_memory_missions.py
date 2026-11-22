from app import service
from app.memory import store
from app.story.missions import add_mission, evaluate, generate_missions, validate_mission


def test_events_persist_and_are_searchable(campaign):
    service.advance(campaign, 12 * 12)
    evs = store.query_events(campaign, q="war", limit=50)
    assert evs and all("war" in (e["title"] + e["body"] + " ".join(e["tags"])).lower() for e in evs[:5])
    hist = store.query_events(campaign, kinds=["history"], limit=100)
    assert any(e["year"] == 1919 and "Versailles" in e["body"] for e in hist), "established history is seeded"


def test_decade_summaries_are_compiled(campaign):
    service.advance(campaign, 12 * 25)
    sums = store.list_summaries(campaign, "decade")
    assert [s["start_year"] for s in sums][:2] == [1930, 1940]
    assert all(s["body"] for s in sums)


def test_retrieval_reaches_deep_history(campaign):
    r = store.retrieve(campaign, "Versailles reparations", ["GER"], 1936)
    assert any("Versailles" in e["body"] for e in r["events"])


def test_missions_generated_from_situation(campaign):
    st, _ = service.load(campaign)
    keys = [m["key"] for m in st["missions"].values()]
    assert any(k.startswith("claims:") for k in keys), "claims become missions"
    assert any(k.startswith("tech:") for k in keys)
    for m in st["missions"].values():
        assert m["title"] and m["desc"] and m["objectives"]


def test_mission_conditions_and_rewards(world_1936):
    s = world_1936
    m = add_mission(s, {"title": "Test", "objectives": [{"text": "x", "cond": {"t": "stability", "min": 10}}], "rewards": {"legitimacy": 10}, "key": "t1"})
    assert evaluate(s, "GER", m["objectives"][0]["cond"])[0]
    from app.story.missions import check_missions
    leg = s["countries"]["GER"]["legitimacy"]
    check_missions(s, "GER", None)
    assert m["status"] == "completed" and s["countries"]["GER"]["legitimacy"] > leg


def test_ai_missions_are_validated(world_1936):
    bad = {"title": "Bad", "objectives": [{"text": "hack", "cond": {"t": "delete_world"}}]}
    assert validate_mission(world_1936, bad) is None
    ok = validate_mission(world_1936, {"title": "Good", "objectives": [{"text": "t", "cond": {"t": "treaty", "target": "ITA"}}], "rewards": {"stability": 999}})
    assert ok and ok["rewards"]["stability"] == 40


def test_missions_superseded_on_phase_change(world_1936):
    s = world_1936
    m = add_mission(s, {"title": "Small state goal", "objectives": [{"text": "x", "cond": {"t": "alliance_count", "min": 9}}], "phases": ["minor_state"], "key": "p1"})
    s["meta"]["phase"] = "great_power"
    from app.story.missions import check_missions
    check_missions(s, "GER", None)
    assert m["status"] == "superseded"


def test_continental_empire_missions(world_1936):
    s = world_1936
    s["meta"]["phase"] = "continental_empire"
    from app.sim.war import transfer_province
    from app.sim.core import build_index
    for pid, p in list(s["provinces"].items()):
        if p["owner"] == "FRA" and p["code"] == "FRA":
            transfer_province(s, pid, "GER", "conquest")
    build_index(s)
    made = generate_missions(s, "GER", max_active=20)
    titles = [m["title"] for m in made]
    assert "Integrate the Occupied Territories" in titles
    assert "An Imperial Administration" in titles


def test_hidden_mission_revealed_by_intelligence(world_1936):
    s = world_1936
    s["countries"]["GER"]["stability"] = 30
    generate_missions(s, "GER")
    hidden = [m for m in s["missions"].values() if m.get("hidden")]
    assert hidden
    from app.orders.executor import execute_actions
    from app.util import rng_for
    execute_actions(s, "GER", [{"type": "espionage", "target": "GER", "op": "investigate"}], rng_for(1, "x"))
    assert not any(m.get("hidden") for m in s["missions"].values())
