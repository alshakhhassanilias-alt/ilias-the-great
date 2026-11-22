"""Server-less API dispatcher used by the in-browser build (Python on WebAssembly).
It mirrors the FastAPI routes in main.py so the same frontend works with or without a server."""
from __future__ import annotations

import json
import re
import traceback
from urllib.parse import parse_qs, urlsplit

from . import db, service
from .ai import providers
from .world.scenario import list_scenarios
from .world.techtree import CATS


def _int(q, k, d=None):
    v = q.get(k)
    return int(v) if v not in (None, "") else d


def _geo_names():
    from .world.geo import get_geo
    g = get_geo()
    return {pid: [p["name"], p["country"]] for pid, p in g.provinces.items()}


def _events(cid, q):
    return service.chronicle(cid, q=q.get("q"), year_from=_int(q, "year_from"), year_to=_int(q, "year_to"), actor=q.get("actor") or None,
                             min_importance=_int(q, "min_importance", 0), limit=min(_int(q, "limit", 200), 1000), offset=_int(q, "offset", 0),
                             order=q.get("order") or "desc", kinds=q["kind"].split(",") if q.get("kind") else None, thread=q.get("thread") or None)


def _tech(cid):
    v = service.tech_view(cid)
    v["categories"] = CATS
    return v


def _create(b):
    year = b.get("year")
    if b["scenario"] == "fictional" and year is None:
        year = 1500
    return {"id": service.create_campaign(b["scenario"], b.get("country"), b.get("name"), year, b.get("divergence", ""), b.get("settings") or {}, b.get("seed"))}


C = r"/api/campaigns/(?P<cid>[\w-]+)"
ROUTES = [
    ("GET", r"/api/health", lambda m, q, b: {"ok": True, "ai": providers.get_config()["provider"], "model": providers.get_config()["model"], "mode": "browser"}),
    ("GET", r"/api/geo/names", lambda m, q, b: _geo_names()),
    ("GET", r"/api/scenarios", lambda m, q, b: list_scenarios()),
    ("GET", r"/api/scenarios/(?P<sid>\w+)/countries", lambda m, q, b: service.scenario_countries(m["sid"], _int(q, "year", 1500 if m["sid"] == "fictional" else None), _int(q, "seed", 1))),
    ("GET", r"/api/campaigns", lambda m, q, b: db.list_campaigns()),
    ("POST", r"/api/campaigns", lambda m, q, b: _create(b)),
    ("POST", r"/api/import", lambda m, q, b: {"id": service.import_campaign(b)}),
    ("GET", r"/api/settings/ai", lambda m, q, b: providers.get_config()),
    ("POST", r"/api/settings/ai", lambda m, q, b: providers.set_config({**b, "provider": "offline"})),
    ("POST", r"/api/settings/ai/test", lambda m, q, b: {"ok": True, "provider": "offline", "message": "This browser edition runs the offline storyteller."}),
    ("GET", C, lambda m, q, b: service.view(m["cid"], include_provinces=q.get("provinces", "true") != "false")),
    ("DELETE", C, lambda m, q, b: (service.delete(m["cid"]), {"ok": True})[1]),
    ("POST", C + r"/advance", lambda m, q, b: service.advance(m["cid"], int(b.get("months", 12)))),
    ("POST", C + r"/orders/interpret", lambda m, q, b: service.interpret(m["cid"], b["text"])),
    ("POST", C + r"/orders/execute", lambda m, q, b: service.execute(m["cid"], b["text"], b.get("actions"))),
    ("POST", C + r"/decisions/(?P<did>[\w-]+)", lambda m, q, b: service.decide(m["cid"], m["did"], b["option"])),
    ("POST", C + r"/switch", lambda m, q, b: service.switch_country(m["cid"], b["tag"])),
    ("GET", C + r"/briefing", lambda m, q, b: service.briefing(m["cid"])),
    ("GET", C + r"/events", lambda m, q, b: _events(m["cid"], q)),
    ("GET", C + r"/summaries", lambda m, q, b: service.summaries(m["cid"])),
    ("POST", C + r"/history", lambda m, q, b: service.write_history(m["cid"], b["request"])),
    ("GET", C + r"/documents", lambda m, q, b: service.documents(m["cid"])),
    ("GET", C + r"/newspaper", lambda m, q, b: service.newspaper(m["cid"], _int(q, "year"), _int(q, "month"), q.get("country") or None)),
    ("GET", C + r"/advisor", lambda m, q, b: service.advisor_report(m["cid"])),
    ("POST", C + r"/advisor/ask", lambda m, q, b: service.advisor_ask(m["cid"], b["question"])),
    ("GET", C + r"/countries/(?P<tag>[\w-]+)", lambda m, q, b: service.country_detail(m["cid"], m["tag"])),
    ("GET", C + r"/diplomacy/(?P<tag>[\w-]+)", lambda m, q, b: service.conversation(m["cid"], m["tag"])),
    ("POST", C + r"/diplomacy/(?P<tag>[\w-]+)", lambda m, q, b: service.talk(m["cid"], m["tag"], b["message"], bool(b.get("secret")))),
    ("GET", C + r"/tech", lambda m, q, b: _tech(m["cid"])),
    ("POST", C + r"/tech", lambda m, q, b: service.set_research(m["cid"], b.get("tech"), b.get("auto"))),
    ("POST", C + r"/missions/(?P<mid>[\w-]+)/(?P<action>\w+)", lambda m, q, b: service.mission_action(m["cid"], m["mid"], m["action"])),
    ("GET", C + r"/rankings", lambda m, q, b: service.rankings(m["cid"])),
    ("GET", C + r"/saves", lambda m, q, b: service.list_snapshots(m["cid"])),
    ("POST", C + r"/saves", lambda m, q, b: service.save_manual(m["cid"], b.get("label", ""))),
    ("POST", C + r"/saves/(?P<sid>\d+)/load", lambda m, q, b: service.restore_snapshot(m["cid"], int(m["sid"]))),
    ("POST", C + r"/saves/(?P<sid>\d+)/branch", lambda m, q, b: {"id": service.branch(m["cid"], int(m["sid"]), b.get("name"))}),
    ("GET", C + r"/saves/(?P<sid>\d+)/map", lambda m, q, b: service.snapshot_map(m["cid"], int(m["sid"]))),
    ("POST", C + r"/duplicate", lambda m, q, b: {"id": service.duplicate(m["cid"], b.get("name"))}),
    ("GET", C + r"/export", lambda m, q, b: service.export_campaign(m["cid"], q.get("snapshots", "true") != "false")),
]
COMPILED = [(meth, re.compile("^" + pat + "$"), fn) for meth, pat, fn in ROUTES]


def handle(method: str, url: str, body: str | None) -> str:
    """Returns a JSON string: {"status": int, "data": ...}."""
    parts = urlsplit(url)
    q = {k: v[-1] for k, v in parse_qs(parts.query).items()}
    b = json.loads(body) if body else {}
    for meth, rx, fn in COMPILED:
        if meth != method:
            continue
        m = rx.match(parts.path)
        if m:
            try:
                return json.dumps({"status": 200, "data": fn(m.groupdict(), q, b)})
            except service.NotFound as e:
                return json.dumps({"status": 404, "data": {"detail": f"Not found: {e}"}})
            except (ValueError, KeyError) as e:
                return json.dumps({"status": 400, "data": {"detail": str(e)}})
            except Exception as e:  # pragma: no cover - surfaced to the UI
                traceback.print_exc()
                return json.dumps({"status": 500, "data": {"detail": f"{type(e).__name__}: {e}"}})
    return json.dumps({"status": 404, "data": {"detail": f"No route for {method} {parts.path}"}})
