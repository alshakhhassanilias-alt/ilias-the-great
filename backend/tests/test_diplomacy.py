from app.sim.relations import modify, opinion
from app.sim.war import start_war
from app.story.diplomacy import classify, talk
from app.util import rng_for


def test_classification():
    assert classify("We propose an alliance") == "alliance"
    assert classify("Let us sign a non-aggression pact") == "non_aggression"
    assert classify("Hand over Danzig or else") == "demand"
    assert classify("Let us make peace") == "peace"


def test_alliance_depends_on_opinion(world_1936):
    s = world_1936
    r = talk(s, "GER", "FRA", "We propose an alliance", False, rng_for(1, "a"), [])
    assert r["outcome"]["accepted"] is False
    modify(s, "ITA", "GER", 80, 30)
    r = talk(s, "GER", "ITA", "We propose an alliance", False, rng_for(1, "b"), [])
    assert r["outcome"]["accepted"] is True
    assert any(t["type"] == "alliance" and set(t["members"]) == {"GER", "ITA"} for t in s["treaties"])


def test_leaders_remember_history(world_1936):
    r = talk(world_1936, "GER", "POL", "What do you think of our shared history?", False, rng_for(1, "c"), [])
    assert "forgotten" in r["reply"] and "1795" in r["reply"]


def test_betrayal_is_remembered(world_1936):
    s = world_1936
    talk(s, "GER", "POL", "We promise we will never attack you", False, rng_for(1, "d"), [])
    before = opinion(s, "POL", "GER")
    start_war(s, "GER", "POL", "conquest")
    mems = [m for m in s["countries"]["POL"]["memories"] if m["other"] == "GER" and m["kind"] == "betrayal"]
    assert mems, "broken non-aggression pact / pledge becomes a betrayal"
    assert opinion(s, "POL", "GER") < before


def test_secret_treaties_are_hidden_from_newspapers(campaign):
    from app import service
    service.load(campaign)[0]["relations"]["SOV>GER"] = {"mod": 60.0, "tmod": 20.0}
    r = service.talk(campaign, "SOV", "Shall we sign a non-aggression pact?", secret=True)
    assert r["outcome"]["accepted"]
    paper = service.newspaper(campaign)
    assert not any("non aggression" in a["headline"].lower() for a in paper["articles"])
