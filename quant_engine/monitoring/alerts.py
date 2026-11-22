"""Alerting: every alert is persisted; optionally POSTed to a webhook (Slack/Discord-compatible).
Webhook failures never affect trading or risk control."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from quant_engine.monitoring.logging import redact

log = logging.getLogger(__name__)


class AlertManager:
    def __init__(self, store: Any | None = None, webhook_url: str = "") -> None:
        self.store = store
        self.webhook_url = webhook_url
        self.sent: list[dict[str, str]] = []

    def send(self, severity: str, title: str, message: str) -> None:
        message = redact(message)
        self.sent.append({"severity": severity, "title": title, "message": message})
        log.log(logging.CRITICAL if severity == "CRITICAL" else logging.WARNING, "ALERT %s: %s", title, message)
        if self.store is not None:
            try:
                self.store.alert(severity, title, message)
            except Exception as exc:  # pragma: no cover - persistence failure is logged only
                log.error("alert persistence failed: %s", exc)
        if self.webhook_url:
            try:
                httpx.post(self.webhook_url, json={"text": f"[{severity}] {title}: {message}"}, timeout=5.0)
            except Exception as exc:
                log.warning("webhook delivery failed: %s", type(exc).__name__)
