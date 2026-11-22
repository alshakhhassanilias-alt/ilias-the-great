"""Command-center API (FastAPI).

Security model
--------------
* Every data and control endpoint requires a Bearer JWT obtained from ``/api/auth/login``
  (PBKDF2-hashed password from the environment).  Only ``/api/health/live`` is public.
* WebSocket clients must send ``{"type": "auth", "token": ...}`` as their first message within
  5 s (tokens are never placed in URLs, which end up in logs).
* CORS is restricted to configured origins; security headers (CSP, frame-deny, nosniff) are set.
* Sliding-window rate limits per client: login 5/min, reads 240/min, controls 10/min.
* Destructive controls require a typed confirmation phrase, are audit-logged, persist the halt
  in the database *immediately* (fail-safe even if the engine process is down), then queue the
  command for the engine (which owns execution) and wait briefly for its acknowledgement.
* No control can relax hard risk limits: resume only clears a halt and is itself audited.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from pathlib import Path
from typing import Any, Literal

import jwt as pyjwt
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from quant_engine.config.settings import AppConfig, EnvSettings, TradingMode
from quant_engine.dashboard.backend.security import RateLimiter, TokenService, verify_password
from quant_engine.dashboard.backend.services import DashboardService
from quant_engine.data import database as db

log = logging.getLogger(__name__)
FRONTEND_DIST = Path(__file__).resolve().parents[3] / "dashboard" / "frontend" / "dist"

CONFIRM = {"kill-switch": "KILL", "flatten": "FLATTEN", "cancel-orders": "CANCEL", "resume": "RESUME"}
COMMAND = {"kill-switch": "kill_switch", "flatten": "flatten", "cancel-orders": "cancel_orders", "resume": "resume"}


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ControlBody(BaseModel):
    confirm: str = Field(max_length=16)
    reason: str = Field(default="", max_length=500)
    discrepancy_explained: bool = False


def create_app(
    cfg: AppConfig,
    env: EnvSettings,
    mode: TradingMode,
    password_hash: str,
    jwt_secret: str,
    serve_frontend: bool = True,
    ack_timeout_s: float = 10.0,
) -> FastAPI:
    engine = db.get_engine(env.database_url)
    svc = DashboardService(engine, mode.value, cfg, Path(env.artifacts_dir))
    tokens = TokenService(jwt_secret, env.dashboard_token_ttl_minutes)
    limiter = RateLimiter()
    bearer = HTTPBearer(auto_error=False)
    app = FastAPI(title="quant_engine command center", docs_url=None, redoc_url=None, openapi_url=None)
    origins = [o.strip() for o in env.dashboard_allowed_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        client = request.client.host if request.client else "unknown"
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/auth"):
            bucket, limit = ("control", 10) if request.url.path.startswith("/api/controls") else ("read", 240)
            if not limiter.allow(bucket, client, limit):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        try:
            resp = await call_next(request)
        except Exception:  # safe error messages: never leak internals
            log.exception("unhandled API error")
            resp = JSONResponse({"detail": "internal error"}, status_code=500)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'"
        )
        resp.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "public, max-age=300"
        return resp

    def audit(actor: str, action: str, details: dict[str, Any], ip: str) -> None:
        with db.transaction(engine) as c:
            c.execute(
                db.audit_log.insert().values(
                    timestamp=db.utc_now_iso(), actor=actor, action=action, details_json=json.dumps(details, default=str), ip=ip
                )
            )

    def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any]:
        if creds is None or creds.scheme.lower() != "bearer":
            raise HTTPException(401, "authentication required")
        try:
            return tokens.verify(creds.credentials)
        except pyjwt.PyJWTError as exc:
            raise HTTPException(401, "invalid or expired token") from exc

    # ------------------------------------------------------------------ public
    @app.get("/api/health/live")
    def live() -> dict[str, Any]:
        return {"ok": True}

    @app.post("/api/auth/login")
    def login(body: LoginBody, request: Request) -> dict[str, Any]:
        ip = request.client.host if request.client else "unknown"
        if not limiter.allow("login", ip, 5):
            raise HTTPException(429, "too many login attempts")
        ok_user = secrets.compare_digest(body.username, env.dashboard_username)
        ok_pw = verify_password(body.password, password_hash)
        if not (ok_user and ok_pw):
            audit(body.username[:64], "login_failed", {}, ip)
            raise HTTPException(401, "invalid credentials")
        audit(body.username, "login", {}, ip)
        return {
            "access_token": tokens.issue(body.username),
            "token_type": "bearer",
            "expires_in": env.dashboard_token_ttl_minutes * 60,
            "mode": mode.value,
        }

    # ------------------------------------------------------------------ reads
    @app.get("/api/overview")
    def overview(_: dict = Depends(current_user)) -> dict[str, Any]:
        return svc.overview()

    @app.get("/api/equity")
    def equity(limit: int = 5000, _: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.equity_series(max(1, min(limit, 50_000)))

    @app.get("/api/positions")
    def positions(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.positions()

    @app.get("/api/orders")
    def orders(limit: int = 200, _: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.orders(max(1, min(limit, 5000)))

    @app.get("/api/trades")
    def trades(limit: int = 1000, _: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.trades(max(1, min(limit, 50_000)))

    @app.get("/api/risk")
    def risk(_: dict = Depends(current_user)) -> dict[str, Any]:
        return svc.risk_panel()

    @app.get("/api/health")
    def health(_: dict = Depends(current_user)) -> dict[str, Any]:
        ok, msg = db.integrity_check(engine)
        return {"heartbeat": svc.heartbeat(), "database": {"ok": ok, "detail": msg}}

    @app.get("/api/strategies")
    def strategies(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.strategies()

    @app.get("/api/regime")
    def regime(_: dict = Depends(current_user)) -> dict[str, Any]:
        d = svc.heartbeat()["details"]
        return {"regimes": d.get("regimes", {}), "timestamp": svc.heartbeat()["timestamp"]}

    @app.get("/api/research")
    def research(_: dict = Depends(current_user)) -> dict[str, Any]:
        r = svc.research_summary()
        if r is None:
            return {"available": False}
        keep: dict[str, Any] = {
            k: r[k]
            for k in (
                "generated_at",
                "data",
                "promotion",
                "combined",
                "benchmarks",
                "deployable",
                "holdout",
                "tournament",
                "n_total_trials",
            )
            if k in r
        }
        keep["strategies"] = {k: {"summary": v["summary"], "windows": v["windows"]} for k, v in r["strategies"].items()}
        return {"available": True, **keep, "series": svc.research_series()}

    @app.get("/api/montecarlo")
    def montecarlo(_: dict = Depends(current_user)) -> dict[str, Any]:
        return svc.monte_carlo()

    @app.get("/api/alerts")
    def alerts(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
        return svc.alerts()

    @app.get("/api/controls/history")
    def control_history(_: dict = Depends(current_user)) -> list[dict[str, Any]]:
        with engine.connect() as c:
            rows = c.execute(select(db.control_commands).order_by(db.control_commands.c.id.desc()).limit(50)).all()
        return [dict(r._mapping) for r in rows]

    # ------------------------------------------------------------------ controls
    @app.post("/api/controls/{action}")
    async def control(
        action: Literal["kill-switch", "flatten", "cancel-orders", "resume"],
        body: ControlBody,
        request: Request,
        user: dict = Depends(current_user),
    ) -> dict[str, Any]:
        ip = request.client.host if request.client else "unknown"
        if body.confirm != CONFIRM[action]:
            raise HTTPException(400, f"confirmation phrase required: type {CONFIRM[action]}")
        actor = user["sub"]
        audit(actor, f"control:{action}", {"reason": body.reason}, ip)
        now = db.utc_now_iso()
        with db.transaction(engine) as c:
            if action in ("kill-switch", "flatten"):
                # Persist the halt immediately: effective even if the engine is offline.
                existing = c.execute(select(db.risk_state).where(db.risk_state.c.mode == mode.value)).first()
                state = json.loads(existing.state_json) if existing and existing.state_json else {}
                state.update(
                    {
                        "halted": True,
                        "requires_authorization": True,
                        "flatten_pending": True,
                        "halt_reason": state.get("halt_reason") or f"{COMMAND[action]}:{actor}",
                        "kill_switch": state.get("kill_switch", False) or action == "kill-switch",
                    }
                )
                row = {
                    "mode": mode.value,
                    "halted": True,
                    "halt_reason": state["halt_reason"],
                    "halted_at": now,
                    "requires_authorization": True,
                    "kill_switch": state["kill_switch"],
                    "state_json": json.dumps(state),
                    "updated_at": now,
                }
                if existing:
                    c.execute(db.risk_state.update().where(db.risk_state.c.mode == mode.value).values(**row))
                else:
                    c.execute(db.risk_state.insert().values(**row, consecutive_errors=0))
            res = c.execute(
                db.control_commands.insert().values(
                    mode=mode.value,
                    command=COMMAND[action],
                    requested_by=actor,
                    requested_at=now,
                    status="queued",
                    result_json=json.dumps({"discrepancy_explained": body.discrepancy_explained, "reason": body.reason}),
                )
            )
            pk = res.inserted_primary_key
            assert pk is not None
            cid = pk[0]
        deadline = asyncio.get_running_loop().time() + ack_timeout_s
        while asyncio.get_running_loop().time() < deadline:
            with engine.connect() as c:
                r = c.execute(select(db.control_commands).where(db.control_commands.c.id == cid)).first()
            if r and r.status != "queued":
                return {
                    "command_id": cid,
                    "status": r.status,
                    "result": json.loads(r.result_json or "{}"),
                    "halt_persisted": action in ("kill-switch", "flatten"),
                }
            await asyncio.sleep(0.25)
        return {
            "command_id": cid,
            "status": "queued",
            "result": {"note": "engine did not acknowledge in time; halt is persisted and will be enforced on start"},
            "halt_persisted": action in ("kill-switch", "flatten"),
        }

    # ------------------------------------------------------------------ websocket
    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        origin = socket.headers.get("origin")
        if origin and origin not in origins:
            await socket.close(code=1008)
            return
        await socket.accept()
        try:
            msg = await asyncio.wait_for(socket.receive_json(), timeout=5)
            if msg.get("type") != "auth":
                raise ValueError("first message must authenticate")
            tokens.verify(str(msg.get("token", "")))
        except Exception:
            await socket.send_json({"type": "error", "detail": "authentication failed"})
            await socket.close(code=1008)
            return
        await socket.send_json({"type": "auth_ok", "mode": mode.value})
        try:
            while True:
                eq = svc.equity_series(1)
                await socket.send_json(
                    {
                        "type": "update",
                        "overview": svc.overview(),
                        "equity_point": eq[-1] if eq else None,
                        "positions": svc.positions(),
                        "risk": {k: v for k, v in svc.risk_panel().items() if k not in ("limits", "events")},
                        "regime": svc.heartbeat()["details"].get("regimes", {}),
                    }
                )
                await asyncio.sleep(2.0)
        except (WebSocketDisconnect, RuntimeError):
            return

    # ------------------------------------------------------------------ static frontend
    if serve_frontend and FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str) -> FileResponse:
            if path.startswith("api/"):
                raise HTTPException(404)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app
