"""Game-master mode: free-text chapters and group chats proposed by Claude, validated and applied by the engine."""
from app import service
from app.sim.core import at_war, idx


def _cid():
    return service.create_campaign("1936", "ITA", settings={"pause_on_decision": False}, seed=5)


def test_story_prompt_contains_world_and_orders():
    cid = _cid()
    p = service.story_prompt(cid, "I replace the army with 40,000 trained pigeons")
    assert "pigeons" in p["prompt"] and "Kingdom of Italy" in p["prompt"] or "Italy" in p["prompt"]
    assert "Allowed \"changes\"" in p["prompt"] and "JSON" in p["system"]


def test_story_apply_changes_world():
    cid = _cid()
    result = {
        "headline": "Pigeon Legion Seizes Corsica",
        "narrative": "The birds were everywhere.\n\nFrance did not see it coming.",
        "events": [{"title": "Panic in Paris", "body": "Feathers.", "countries": ["France"], "importance": 4}],
        "reactions": [{"country": "France", "leader": "Lebrun", "quote": "Absurd!"}],
        "changes": [
            {"op": "war", "attacker": "Italy", "defender": "France"},
            {"op": "territory", "from": "France", "to": "Italy", "regions": ["Corsica"]},
            {"op": "new_country", "name": "Republic of Feathers", "from": "Italy", "regions": ["Cagliari"], "ideology": "Avian Syndicalism", "leader": "Il Piccione"},
            {"op": "stats", "country": "Italy", "stability": 10, "army_pct": -20},
            {"op": "teleport", "country": "Italy"},
        ],
        "months": 0,
    }
    r = service.story_apply(cid, "pigeons", result)
    assert any("declared war" in x for x in r["applied"])
    assert any("Corsica" in x or "region" in x for x in r["applied"])
    assert any("Republic of Feathers" in x for x in r["applied"])
    assert any("teleport" in x for x in r["rejected"])
    state, _ = service.load(cid)
    assert at_war(state, "ITA", "FRA")
    feathers = [t for t, c in state["countries"].items() if c["name"] == "Republic of Feathers"]
    assert feathers and state["countries"][feathers[0]]["leader"]["name"] == "Il Piccione"
    st = service.stories(cid)
    assert st and st[-1]["title"] == "Pigeon Legion Seizes Corsica" and st[-1]["data"]["orders"] == "pigeons"
    assert "pigeons" not in service.story_prompt(cid, "next")["prompt"] or "Pigeon Legion" in service.story_prompt(cid, "next")["prompt"]


def test_story_auto_offline():
    cid = _cid()
    r = service.story_auto(cid, "Build railways everywhere", 2)
    assert service.stories(cid) and "events" in r


def test_group_chat_flow():
    cid = _cid()
    ch = service.create_chat(cid, "Axis of Chaos", ["Germany", "Japan", "France"])
    assert len(ch["members"]) == 3
    p = service.chat_prompt(cid, ch["id"], "who wants to split Switzerland lol")
    assert "Axis of Chaos" in p["prompt"]
    out = service.chat_apply(cid, ch["id"], "who wants to split Switzerland lol", {
        "messages": [{"country": "Germany", "text": "Only if I get the chocolate."}, {"country": "France", "text": "Non."},
                     {"country": "United States", "text": "not in chat"}],
        "changes": [{"op": "treaty", "a": "Italy", "b": "Germany", "type": "alliance"},
                    {"op": "treaty", "a": "United Kingdom", "b": "United States", "type": "alliance"}],
    })
    assert [m["country"] for m in out["messages"]] == ["German Reich", "French Republic"] or len(out["messages"]) == 2
    assert len(out["applied"]) == 1 and len(out["rejected"]) == 1
    v = service.chat_view(cid, ch["id"])
    assert len(v["messages"]) == 3 and v["messages"][0]["role"] == "player"
    auto = service.chat_auto(cid, ch["id"], "alliance?")
    assert auto["messages"]
    assert service.chats(cid) and service.delete_chat(cid, ch["id"])["ok"] and not service.chats(cid)


def test_browser_routes():
    import json
    from app import browser
    cid = _cid()
    r = json.loads(browser.handle("POST", f"/api/campaigns/{cid}/chats", json.dumps({"name": "x", "members": ["Germany"]})))
    assert r["status"] == 200, r
    gid = r["data"]["id"]
    r = json.loads(browser.handle("POST", f"/api/campaigns/{cid}/chats/{gid}/prompt", json.dumps({"text": "hi"})))
    assert r["status"] == 200 and "prompt" in r["data"]
    r = json.loads(browser.handle("GET", f"/api/campaigns/{cid}/story", None))
    assert r["status"] == 200
