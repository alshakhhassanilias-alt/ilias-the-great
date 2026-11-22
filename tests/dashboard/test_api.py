"""Dashboard API security and control-path tests (FastAPI TestClient, temp database)."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from quant_engine.config.settings import EnvSettings, TradingMode
from quant_engine.dashboard.backend.app import create_app
from quant_engine.dashboard.backend.security import RateLimiter, TokenService, hash_password, verify_password
from quant_engine.data import database as db

PW = "correct horse battery staple"


@pytest.fixture
def client(cfg, tmp_path):
    env = EnvSettings(
        _env_file=None, database_url=f"sqlite:///{tmp_path}/d.sqlite", artifacts_dir=str(tmp_path), dashboard_username="operator"
    )
    app = create_app(cfg, env, TradingMode.PAPER, hash_password(PW), "x" * 64, serve_frontend=False, ack_timeout_s=0.5)
    return TestClient(app), env


def login(c):
    r = c.post("/api/auth/login", json={"username": "operator", "password": PW})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_password_hashing_roundtrip():
    h = hash_password(PW)
    assert verify_password(PW, h) and not verify_password("wrong password!!", h)
    with pytest.raises(ValueError):
        hash_password("short")


def test_token_service_rejects_tampering():
    ts = TokenService("s" * 40)
    tok = ts.issue("op")
    assert ts.verify(tok)["sub"] == "op"
    with pytest.raises(Exception):
        TokenService("t" * 40).verify(tok)


@pytest.mark.parametrize(
    "path",
    [
        "/api/overview",
        "/api/positions",
        "/api/orders",
        "/api/trades",
        "/api/risk",
        "/api/strategies",
        "/api/montecarlo",
        "/api/research",
        "/api/equity",
        "/api/health",
    ],
)
def test_every_data_endpoint_requires_auth(client, path):
    c, _ = client
    assert c.get(path).status_code == 401
    assert c.get(path, headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_controls_require_auth(client):
    c, _ = client
    assert c.post("/api/controls/kill-switch", json={"confirm": "KILL"}).status_code == 401


def test_login_failure_and_rate_limit(client):
    c, _ = client
    for _ in range(5):
        assert c.post("/api/auth/login", json={"username": "operator", "password": "nope"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "operator", "password": PW}).status_code == 429


def test_security_headers_and_overview_without_data(client):
    c, _ = client
    h = login(c)
    r = c.get("/api/overview", headers=h)
    assert r.status_code == 200
    assert r.headers["X-Frame-Options"] == "DENY" and "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    body = r.json()
    assert body["mode"] == "PAPER" and body["total_equity"] is None  # no fabricated numbers


def test_destructive_control_requires_confirmation_phrase(client):
    c, _ = client
    h = login(c)
    r = c.post("/api/controls/kill-switch", json={"confirm": "yes"}, headers=h)
    assert r.status_code == 400


def test_kill_switch_persists_halt_immediately_and_queues_command(client):
    c, env = client
    h = login(c)
    r = c.post("/api/controls/kill-switch", json={"confirm": "KILL", "reason": "test"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["halt_persisted"] and body["status"] == "queued"  # no engine running in this test
    eng = db.get_engine(env.database_url)
    with eng.connect() as conn:
        rs = conn.execute(select(db.risk_state)).first()
        assert rs.halted and rs.kill_switch and rs.requires_authorization
        assert json.loads(rs.state_json)["flatten_pending"]
        cmd = conn.execute(select(db.control_commands)).first()
        assert cmd.command == "kill_switch" and cmd.requested_by == "operator"
        audit = conn.execute(select(db.audit_log).where(db.audit_log.c.action == "control:kill-switch")).first()
        assert audit is not None
    assert c.get("/api/overview", headers=h).json()["halted"] is True


def test_websocket_requires_auth(client):
    c, _ = client
    with c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": "bad"})
        assert ws.receive_json()["type"] == "error"
    h = login(c)
    tok = h["Authorization"].split()[1]
    with c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": tok})
        assert ws.receive_json()["type"] == "auth_ok"
        msg = ws.receive_json()
        assert msg["type"] == "update" and msg["overview"]["mode"] == "PAPER"


def test_rate_limiter_window():
    rl = RateLimiter()
    assert all(rl.allow("b", "ip", 3) for _ in range(3))
    assert not rl.allow("b", "ip", 3)
