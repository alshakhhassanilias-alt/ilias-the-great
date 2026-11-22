"""FastAPI application for INFINITE HISTORY."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import service
from .ai import providers
from .world.scenario import list_scenarios
from .world.techtree import CATS

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Infinite History", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(service.NotFound)
async def _nf(request: Request, exc: service.NotFound):
    return JSONResponse({"detail": f"Not found: {exc}"}, status_code=404)


class NewCampaign(BaseModel):
    scenario: str
    country: str | None = None
    name: str | None = None
    year: int | None = None
    divergence: str = ""
    seed: int | None = None
    settings: dict = Field(default_factory=dict)


class Advance(BaseModel):
    months: int = 12


class OrderIn(BaseModel):
    text: str
    actions: list[dict] | None = None


class Talk(BaseModel):
    message: str
    secret: bool = False


class Ask(BaseModel):
    question: str


class HistoryReq(BaseModel):
    request: str


class Decide(BaseModel):
    option: str


class Label(BaseModel):
    label: str = ""


class Research(BaseModel):
    tech: str | None = None
    auto: bool | None = None


class Name(BaseModel):
    name: str | None = None


class Switch(BaseModel):
    tag: str


@app.get("/api/health")
def health():
    cfg = providers.get_config()
    return {"ok": True, "ai": cfg["provider"], "model": cfg["model"]}


@app.get("/api/geo/names")
def geo_names():
    from .world.geo import get_geo
    g = get_geo()
    return {pid: [p["name"], p["country"]] for pid, p in g.provinces.items()}


@app.get("/api/scenarios")
def scenarios():
    return list_scenarios()


@app.get("/api/scenarios/{sid}/countries")
def scenario_countries(sid: str, year: int | None = None, seed: int = 1):
    if sid not in [s["id"] for s in list_scenarios()]:
        raise HTTPException(404, "Unknown scenario")
    if sid == "fictional" and year is None:
        year = 1500
    return service.scenario_countries(sid, year, seed)


@app.get("/api/campaigns")
def campaigns():
    return service.db.list_campaigns()


@app.post("/api/campaigns")
def create(body: NewCampaign):
    if body.scenario not in [s["id"] for s in list_scenarios()]:
        raise HTTPException(400, "Unknown scenario")
    if body.scenario == "fictional" and body.year is None:
        body.year = 1500
    cid = service.create_campaign(body.scenario, body.country, body.name, body.year, body.divergence, body.settings, body.seed)
    return {"id": cid}


@app.get("/api/campaigns/{cid}")
def get_campaign(cid: str, provinces: bool = True):
    return service.view(cid, include_provinces=provinces)


@app.delete("/api/campaigns/{cid}")
def delete_campaign(cid: str):
    service.delete(cid)
    return {"ok": True}


@app.post("/api/campaigns/{cid}/advance")
def advance(cid: str, body: Advance):
    res = service.advance(cid, body.months)
    return res


@app.post("/api/campaigns/{cid}/orders/interpret")
def interpret(cid: str, body: OrderIn):
    return service.interpret(cid, body.text)


@app.post("/api/campaigns/{cid}/orders/execute")
def execute(cid: str, body: OrderIn):
    return service.execute(cid, body.text, body.actions)


@app.post("/api/campaigns/{cid}/decisions/{did}")
def decide(cid: str, did: str, body: Decide):
    return service.decide(cid, did, body.option)


@app.post("/api/campaigns/{cid}/switch")
def switch(cid: str, body: Switch):
    return service.switch_country(cid, body.tag)


@app.get("/api/campaigns/{cid}/briefing")
def briefing(cid: str):
    return service.briefing(cid)


@app.get("/api/campaigns/{cid}/events")
def events(cid: str, q: str | None = None, year_from: int | None = None, year_to: int | None = None, actor: str | None = None,
           min_importance: int = 0, limit: int = 200, offset: int = 0, order: str = "desc", kind: str | None = None, thread: str | None = None):
    return service.chronicle(cid, q=q, year_from=year_from, year_to=year_to, actor=actor, min_importance=min_importance, limit=min(limit, 1000),
                             offset=offset, order=order, kinds=kind.split(",") if kind else None, thread=thread)


@app.get("/api/campaigns/{cid}/summaries")
def summaries(cid: str):
    return service.summaries(cid)


@app.post("/api/campaigns/{cid}/history")
def write_history(cid: str, body: HistoryReq):
    return service.write_history(cid, body.request)


@app.get("/api/campaigns/{cid}/documents")
def documents(cid: str):
    return service.documents(cid)


@app.get("/api/campaigns/{cid}/newspaper")
def newspaper(cid: str, year: int | None = None, month: int | None = None, country: str | None = None):
    return service.newspaper(cid, year, month, country)


@app.get("/api/campaigns/{cid}/advisor")
def advisor(cid: str):
    return service.advisor_report(cid)


@app.post("/api/campaigns/{cid}/advisor/ask")
def advisor_ask(cid: str, body: Ask):
    return service.advisor_ask(cid, body.question)


@app.get("/api/campaigns/{cid}/countries/{tag}")
def country(cid: str, tag: str):
    return service.country_detail(cid, tag)


@app.get("/api/campaigns/{cid}/diplomacy/{tag}")
def diplomacy_history(cid: str, tag: str):
    return service.conversation(cid, tag)


@app.post("/api/campaigns/{cid}/diplomacy/{tag}")
def diplomacy(cid: str, tag: str, body: Talk):
    return service.talk(cid, tag, body.message, body.secret)


@app.get("/api/campaigns/{cid}/tech")
def tech(cid: str):
    v = service.tech_view(cid)
    v["categories"] = CATS
    return v


@app.post("/api/campaigns/{cid}/tech")
def set_tech(cid: str, body: Research):
    return service.set_research(cid, body.tech, body.auto)


@app.post("/api/campaigns/{cid}/missions/{mid}/{action}")
def mission(cid: str, mid: str, action: str):
    return service.mission_action(cid, mid, action)


@app.get("/api/campaigns/{cid}/rankings")
def rankings(cid: str):
    return service.rankings(cid)


@app.get("/api/campaigns/{cid}/memory")
def memory(cid: str, q: str, k: int = 12):
    from .memory.store import retrieve
    state, _ = service.load(cid)
    return retrieve(cid, q, [state["meta"]["player"]], state["meta"]["year"], k)


@app.get("/api/campaigns/{cid}/saves")
def saves(cid: str):
    return service.list_snapshots(cid)


@app.post("/api/campaigns/{cid}/saves")
def save(cid: str, body: Label):
    return service.save_manual(cid, body.label)


@app.post("/api/campaigns/{cid}/saves/{sid}/load")
def load_save(cid: str, sid: int):
    return service.restore_snapshot(cid, sid)


@app.post("/api/campaigns/{cid}/saves/{sid}/branch")
def branch(cid: str, sid: int, body: Name):
    return {"id": service.branch(cid, sid, body.name)}


@app.get("/api/campaigns/{cid}/saves/{sid}/map")
def snap_map(cid: str, sid: int):
    return service.snapshot_map(cid, sid)


@app.post("/api/campaigns/{cid}/duplicate")
def duplicate(cid: str, body: Name):
    return {"id": service.duplicate(cid, body.name)}


@app.get("/api/campaigns/{cid}/export")
def export(cid: str, snapshots: bool = True):
    data = service.export_campaign(cid, snapshots)
    name = (data["campaign"]["name"] or "campaign").replace(" ", "_")
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{name}.ihc.json"'})


@app.post("/api/import")
async def import_(request: Request):
    try:
        data = await request.json()
        return {"id": service.import_campaign(data)}
    except (ValueError, KeyError) as e:
        raise HTTPException(400, f"Invalid campaign file: {e}")


@app.get("/api/settings/ai")
def ai_settings():
    return providers.get_config()


@app.post("/api/settings/ai")
def set_ai(body: dict[str, Any]):
    return providers.set_config(body)


@app.post("/api/settings/ai/test")
def test_ai():
    return providers.test_connection()


DIST = Path(os.environ.get("IH_FRONTEND", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
