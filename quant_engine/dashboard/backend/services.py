"""Read-side queries for the dashboard (database + research artifacts)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import desc, select
from sqlalchemy.engine import Engine

from quant_engine.config.settings import AppConfig
from quant_engine.data import database as db


class DashboardService:
    def __init__(self, engine: Engine, mode: str, cfg: AppConfig, artifacts_dir: Path) -> None:
        self.engine = engine
        self.mode = mode
        self.cfg = cfg
        self.art = artifacts_dir

    def _rows(self, stmt: Any) -> list[dict[str, Any]]:
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(stmt)]

    def heartbeat(self) -> dict[str, Any]:
        r = self._rows(select(db.engine_heartbeat).where(db.engine_heartbeat.c.mode == self.mode))
        if not r:
            return {"status": "DISCONNECTED", "timestamp": None, "details": {}, "age_seconds": None}
        hb = r[0]
        age = (pd.Timestamp.now(tz="UTC") - pd.Timestamp(hb["timestamp"])).total_seconds()
        status = hb["status"]
        if age > 60 and status not in ("STOPPED",):
            status = "DISCONNECTED"
        return {
            "status": status,
            "timestamp": hb["timestamp"],
            "age_seconds": age,
            "details": json.loads(hb["details_json"] or "{}"),
        }

    def account(self) -> dict[str, Any] | None:
        r = self._rows(select(db.account_state).where(db.account_state.c.mode == self.mode))
        return r[0] if r else None

    def risk_state(self) -> dict[str, Any]:
        r = self._rows(select(db.risk_state).where(db.risk_state.c.mode == self.mode))
        if not r:
            return {"halted": False, "kill_switch": False, "requires_authorization": False, "state": {}}
        row = r[0]
        row["state"] = json.loads(row.pop("state_json") or "{}")
        return row

    def equity_series(self, limit: int = 5000) -> list[dict[str, Any]]:
        rows = self._rows(
            select(db.equity_snapshots)
            .where(db.equity_snapshots.c.mode == self.mode)
            .order_by(desc(db.equity_snapshots.c.id))
            .limit(limit)
        )
        return list(reversed(rows))

    def positions(self) -> list[dict[str, Any]]:
        rows = self._rows(select(db.positions).where(db.positions.c.mode == self.mode))
        marks = self.heartbeat()["details"].get("marks", {})
        for p in rows:
            px = marks.get(p["symbol"])
            p["current_price"] = px
            p["unrealized_pnl"] = p["quantity"] * (px - p["avg_entry_price"]) if px else None
            p["notional"] = abs(p["quantity"]) * (px or p["avg_entry_price"])
            p["direction"] = "LONG" if p["quantity"] > 0 else "SHORT"
            p["diagnostic"] = p["strategy_id"] == "diagnostic_probe"
        return rows

    def orders(self, limit: int = 200) -> list[dict[str, Any]]:
        return self._rows(
            select(db.orders).where(db.orders.c.mode == self.mode).order_by(desc(db.orders.c.updated_at)).limit(limit)
        )

    def trades(self, limit: int = 1000) -> list[dict[str, Any]]:
        return self._rows(
            select(db.trades).where(db.trades.c.mode == self.mode).order_by(desc(db.trades.c.exit_time)).limit(limit)
        )

    def risk_events(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._rows(
            select(db.risk_events).where(db.risk_events.c.mode == self.mode).order_by(desc(db.risk_events.c.id)).limit(limit)
        )

    def alerts(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._rows(select(db.alerts).order_by(desc(db.alerts.c.id)).limit(limit))

    def strategies(self) -> list[dict[str, Any]]:
        live = {r["strategy_id"]: r for r in self._rows(select(db.strategy_state).where(db.strategy_state.c.mode == self.mode))}
        research = self.research_summary()
        promo = research.get("promotion", {}) if research else {}
        out = []
        for name, sc in self.cfg.strategies.strategies.items():
            r = live.get(name, {})
            s = (research or {}).get("strategies", {}).get(name, {}).get("summary", {})
            out.append(
                {
                    "strategy_id": name,
                    "timeframe": sc.timeframe,
                    "max_weight": sc.max_weight,
                    "validation_status": promo.get(name, {}).get("status", "unvalidated"),
                    "live_weight": r.get("weight", 0.0),
                    "last_signal_ts": r.get("last_signal_ts"),
                    "oos_sharpe": s.get("sharpe"),
                    "oos_net_return": s.get("net_return"),
                    "oos_max_drawdown": s.get("max_drawdown"),
                    "oos_trades": s.get("total_trades"),
                    "dsr": s.get("dsr"),
                    "pbo": s.get("pbo"),
                }
            )
        return out

    def research_summary(self) -> dict[str, Any] | None:
        p = self.art / "research" / "research_results.json"
        return json.loads(p.read_text()) if p.exists() else None

    def research_series(self) -> dict[str, Any]:
        p = self.art / "research" / "series" / "oos_equity_curves.csv"
        if not p.exists():
            return {}
        df = pd.read_csv(p, index_col=0, parse_dates=True)
        df = df.resample("1D").last()
        out: dict[str, Any] = {"index": [str(i.date()) for i in df.index], "curves": {}, "rolling_sharpe": {}, "drawdown": {}}
        for c in df.columns:
            s = df[c].ffill()
            out["curves"][c] = _clean(s.round(5).tolist())
            r = s.pct_change()
            rs = r.rolling(90, min_periods=45).mean() / r.rolling(90, min_periods=45).std() * np.sqrt(365)
            out["rolling_sharpe"][c] = _clean(rs.round(3).tolist())
            out["drawdown"][c] = _clean((s / s.cummax() - 1).round(5).tolist())
        return out

    def monte_carlo(self) -> dict[str, Any]:
        p = self.art / "research" / "series" / "monte_carlo_distributions.json"
        res = self.research_summary() or {}
        mc = res.get("monte_carlo", {})
        dist = json.loads(p.read_text()) if p.exists() else {}
        return {
            "portfolio": mc.get("portfolio"),
            "qualified": mc.get("qualified"),
            "summary": mc.get("summary", {}),
            "distributions": dist,
        }

    def overview(self) -> dict[str, Any]:
        acct = self.account()
        hb = self.heartbeat()
        risk = self.risk_state()
        eq_rows = self.equity_series(1)
        last = eq_rows[-1] if eq_rows else None
        init = acct["initial_capital"] if acct else None
        equity = last["equity"] if last else (acct["cash"] if acct else None)
        st = risk.get("state", {})
        day_start = st.get("day_start_equity") or (acct or {}).get("day_start_equity")
        hwm = st.get("high_water_mark") or (acct or {}).get("high_water_mark")
        trades = self.trades(100000)
        realized = float(sum(t["pnl"] for t in trades)) if trades else 0.0
        gross = last["gross_exposure"] if last else 0.0
        return {
            "mode": self.mode,
            "system_status": "HALTED" if risk.get("halted") else hb["status"],
            "engine_heartbeat_age_s": hb["age_seconds"],
            "has_data": acct is not None,
            "total_equity": equity,
            "available_balance": (acct["cash"] - gross / self.cfg.risk.exposure.max_leverage) if acct else None,
            "cash": acct["cash"] if acct else None,
            "unrealized_pnl": last["unrealized_pnl"] if last else None,
            "realized_pnl": realized,
            "daily_pnl": (equity - day_start) if equity is not None and day_start else None,
            "total_return": (equity / init - 1) if equity and init else None,
            "current_drawdown": (1 - equity / hwm) if equity and hwm else None,
            "gross_exposure": gross,
            "halted": bool(risk.get("halted")),
            "kill_switch": bool(risk.get("kill_switch")),
            "halt_reason": risk.get("halt_reason"),
            "timestamp": last["timestamp"] if last else None,
        }

    def risk_panel(self) -> dict[str, Any]:
        ov = self.overview()
        cb = self.cfg.risk.circuit_breakers
        risk = self.risk_state()
        st = risk.get("state", {})
        hb = self.heartbeat()
        health = hb["details"].get("health", {})
        eq = ov["total_equity"]
        day_start = st.get("day_start_equity")
        daily_dd = max(0.0, 1 - eq / day_start) if eq and day_start else 0.0
        return {
            "daily_drawdown": daily_dd,
            "daily_drawdown_limit": cb.daily_drawdown_limit,
            "total_drawdown": ov["current_drawdown"] or 0.0,
            "total_drawdown_limit": cb.max_total_drawdown,
            "halted": risk.get("halted", False),
            "kill_switch": risk.get("kill_switch", False),
            "halt_reason": risk.get("halt_reason"),
            "requires_authorization": risk.get("requires_authorization", False),
            "transient_blocks": st.get("transient_blocks", {}),
            "breach_count": st.get("breach_count", {}),
            "api_latency_ms": health.get("api_latency_ms"),
            "data_age_seconds": health.get("data_age_seconds"),
            "consecutive_errors": health.get("consecutive_errors"),
            "exchange_connectivity": hb["status"],
            "health_reasons": health.get("reasons", []),
            "limits": self.cfg.risk.model_dump(mode="json"),
            "events": self.risk_events(50),
        }


def _clean(xs: list[Any]) -> list[Any]:
    return [None if (isinstance(x, float) and not np.isfinite(x)) else x for x in xs]
