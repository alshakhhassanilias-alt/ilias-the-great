"""Structured JSON logging with secret redaction.

Every record is emitted as one JSON object (timestamp, level, logger, message, extra
fields).  A redaction filter scrubs anything that looks like a credential, and the
values of configured secrets, before a record reaches any handler.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import re
import sys
from pathlib import Path
from typing import Any

_SECRET_KEYS = re.compile(r"(api[_-]?key|secret|passphrase|password|token|signature|authorization)", re.I)
_SECRET_INLINE = re.compile(
    r"((?:api[_-]?key|secret|passphrase|password|token|signature|authorization)[\"']?\s*[:=]\s*[\"']?)([^\"'\s,&}]+)",
    re.I,
)
_STD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


def _secret_values() -> list[str]:
    vals = []
    for k, v in os.environ.items():
        if _SECRET_KEYS.search(k) and v and len(v) >= 8 and v != "proxy-injected":
            vals.append(v)
    return vals


def redact(text: str, extra_secrets: list[str] | None = None) -> str:
    out = _SECRET_INLINE.sub(r"\1***REDACTED***", text)
    for s in (extra_secrets or []) + _secret_values():
        out = out.replace(s, "***REDACTED***")
    return out


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            msg = str(record.msg)
        record.msg = redact(msg)
        record.args = None
        for k, v in list(record.__dict__.items()):
            if k in _STD_ATTRS:
                continue
            if _SECRET_KEYS.search(k):
                record.__dict__[k] = "***REDACTED***"
            elif isinstance(v, str):
                record.__dict__[k] = redact(v)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S") + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k not in _STD_ATTRS and not k.startswith("_"):
                payload[k] = v
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


JsonFormatter.converter = __import__("time").gmtime  # type: ignore[assignment]


def setup_logging(name: str = "quant_engine", level: int = logging.INFO, log_dir: str | None = None) -> None:
    root = logging.getLogger()
    if getattr(root, "_qe_configured", False):
        return
    root.setLevel(level)
    fmt = JsonFormatter()
    filt = RedactingFilter()
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    sh.addFilter(filt)
    root.addHandler(sh)
    d = Path(str(log_dir or os.environ.get("LOG_DIR") or Path(__file__).resolve().parents[2] / "logs"))
    d.mkdir(parents=True, exist_ok=True)
    fh = logging.handlers.RotatingFileHandler(d / f"{name}.jsonl", maxBytes=20_000_000, backupCount=5)
    fh.setFormatter(fmt)
    fh.addFilter(filt)
    root.addHandler(fh)
    for noisy in ("urllib3", "httpx", "httpcore", "asyncio", "ccxt"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    root._qe_configured = True  # type: ignore[attr-defined]
