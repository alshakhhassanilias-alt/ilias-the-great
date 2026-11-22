import json

import pytest
from fastapi.testclient import TestClient

from app import service
from app.ai import providers


def test_autosave_and_reload_from_disk(campaign):
    service.advance(campaign, 24)
    y = service.load(campaign)[0]["meta"]["year"]
    service._cache.clear()
    st, info = service.load(campaign)
    assert st["meta"]["year"] == y and st["meta"]["player"] == "GER"


def test_manual_save_restore_and_branch(campaign):
    sid = service.save_manual(campaign, "Before the storm")["id"]
    n_events = len(service.chronicle(campaign, limit=5000))
    service.advance(campaign, 60)
    assert len(service.chronicle(campaign, limit=5000)) > n_events
    b = service.branch(campaign, sid)
    assert service.load(b)[0]["meta"]["year"] == 1936
    service.restore_snapshot(campaign, sid)
    assert service.load(campaign)[0]["meta"]["year"] == 1936
    assert len(service.chronicle(campaign, limit=5000)) == n_events


def test_export_import_duplicate(campaign):
    service.advance(campaign, 12)
    data = service.export_campaign(campaign)
    s = json.dumps(data)
    new = service.import_campaign(json.loads(s))
    a, b = service.load(campaign)[0], service.load(new)[0]
    assert a["meta"]["year"] == b["meta"]["year"]
    assert len(service.chronicle(new, limit=5000)) == len(service.chronicle(campaign, limit=5000))
    d = service.duplicate(campaign)
    assert d != campaign and service.load(d)[0]["meta"]["player"] == "GER"
    with pytest.raises(ValueError):
        service.import_campaign({"format": "nope"})


def test_offline_fallback_everywhere(campaign):
    assert providers.generate("orders", "s", "p") is None
    assert service.interpret(campaign, "Propose an alliance with Italy")["interpreter"] == "offline"
    assert service.newspaper(campaign)["source"] == "offline"
    assert service.advisor_ask(campaign, "What should we do?")["source"] == "offline"


def test_misconfigured_provider_falls_back(campaign, monkeypatch):
    providers.set_config({"provider": "anthropic", "model": "claude-opus-5-5"})
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert providers.generate("orders", "s", "p") is None
    assert service.interpret(campaign, "Invest 5% of GDP into research")["interpreter"] == "offline"
    providers.set_config({"provider": "offline"})


def test_ai_proposals_are_validated(campaign, monkeypatch):
    calls = {}

    def fake(feature, system, prompt, max_tokens=2000):
        calls[feature] = calls.get(feature, 0) + 1
        return {"actions": [{"type": "set_budget", "category": "research", "value": 0.05}, {"type": "summon_dragons"},
                            {"type": "declare_war", "target": "NOPE"}], "notes": "ok", "clarify": None}
    monkeypatch.setattr(service, "feature_enabled", lambda f: True)
    monkeypatch.setattr(service, "generate_json", fake)
    plan = service.interpret(campaign, "do science")
    assert plan["interpreter"] == "ai"
    assert [a["type"] for a in plan["actions"]] == ["set_budget", "declare_war"], "unknown types are dropped"
    assert plan["actions"][1]["assessment"]["ok"] is False, "invalid targets are rejected by validation"
    r = service.execute(campaign, "do science", [{k: v for k, v in a.items() if k not in ("assessment", "summary")} for a in plan["actions"]])
    assert service.load(campaign)[0]["countries"]["GER"]["budget"]["research"] == 0.05


def test_broken_provider_output_is_ignored(campaign, monkeypatch):
    monkeypatch.setattr(service, "feature_enabled", lambda f: True)
    monkeypatch.setattr(service, "generate_json", lambda *a, **k: None)
    assert service.interpret(campaign, "Propose an alliance with Italy")["interpreter"] == "offline"
    assert providers.parse_json("```json\n{\"a\": 1}\n```") == {"a": 1}
    assert providers.parse_json("garbage") is None


def test_api_endpoints():
    from app.main import app
    c = TestClient(app)
    assert c.get("/api/health").json()["ok"]
    assert len(c.get("/api/scenarios").json()) == 5
    cid = c.post("/api/campaigns", json={"scenario": "1936", "country": "ITA", "settings": {"pause_on_decision": False}}).json()["id"]
    v = c.get(f"/api/campaigns/{cid}").json()
    assert v["player"]["tag"] == "ITA" and len(v["provinces"]) > 1300
    r = c.post(f"/api/campaigns/{cid}/advance", json={"months": 12}).json()
    assert r["to"] == 1937
    assert c.post(f"/api/campaigns/{cid}/orders/interpret", json={"text": "Propose an alliance with Germany"}).json()["actions"]
    assert c.get(f"/api/campaigns/{cid}/newspaper").json()["masthead"]
    assert c.get(f"/api/campaigns/{cid}/tech").json()["techs"]
    assert c.get(f"/api/campaigns/{cid}/advisor").json()["summary"]
    assert c.get(f"/api/campaigns/{cid}/countries/GER").json()["name"] == "Germany"
    assert c.post(f"/api/campaigns/{cid}/history", json={"request": "Write the history of Italy"}).json()["title"]
    assert c.get(f"/api/campaigns/{cid}/export").status_code == 200
    assert c.get("/api/campaigns/doesnotexist").status_code == 404
    assert c.get("/api/geo/names").json()["DEU-06"][0]


def test_newspapers_adapt_to_era():
    from app.story.narrative import paper_style
    assert [paper_style(y) for y in (1700, 1936, 1990, 2100, 2500, 3500)] == ["broadside", "broadsheet", "modern", "feed", "neural", "weave"]


def test_newspaper_and_histories_use_recorded_events(campaign):
    service.advance(campaign, 36)
    paper = service.newspaper(campaign)
    ids = {e["id"] for e in service.chronicle(campaign, limit=5000)}
    assert paper["articles"] and all(a["event_id"] in ids for a in paper["articles"])
    doc = service.write_history(campaign, "Write the history of Germany from 1936 to 1939")
    assert doc["chapters"] and doc["sources"] > 0
    titles = {e["title"] for e in service.chronicle(campaign, limit=5000)}
    assert any(t in doc["chapters"][0]["body"] or t.lower() in doc["chapters"][0]["body"].lower() for t in titles) or doc["chapters"][0]["events"]


def test_divergence_applies_alternate_history():
    cid = service.create_campaign("1936", "FRA", divergence="Italy is allied with France", settings={"pause_on_decision": False}, seed=3)
    st = service.load(cid)[0]
    assert any(set(t["members"]) == {"ITA", "FRA"} for t in st["treaties"])
    assert service.chronicle(cid, kinds=["divergence"])
