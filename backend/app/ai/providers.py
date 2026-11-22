"""AI provider abstraction. The game never requires an API key: the offline provider makes every system
work deterministically, and cloud/local models only enrich text and propose structured actions, which are
always validated before they touch the authoritative world state."""
from __future__ import annotations

import json
import logging
import os
import re
import time

from .. import db

log = logging.getLogger("ih.ai")

DEFAULTS = {
    "provider": os.environ.get("IH_AI_PROVIDER", "offline"),
    "model": os.environ.get("IH_AI_MODEL", ""),
    "base_url": os.environ.get("IH_AI_BASE_URL", ""),
    "effort": os.environ.get("IH_AI_EFFORT", "low"),
    "timeout": float(os.environ.get("IH_AI_TIMEOUT", "60")),
    "features": {"orders": True, "missions": True, "diplomacy": True, "newspapers": True, "chronicle": True, "advisor": True, "briefing": True, "summaries": False},
}
MODEL_DEFAULTS = {"anthropic": "claude-opus-5-5", "openai": "gpt-4o-mini", "ollama": "llama3.1"}
STATS = {"calls": 0, "failures": 0, "last_error": None, "last_latency": None}


def get_config(include_secret: bool = False) -> dict:
    cfg = dict(DEFAULTS)
    cfg["features"] = dict(DEFAULTS["features"])
    stored = db.get_setting("ai", {}) or {}
    for k, v in stored.items():
        if k == "features":
            cfg["features"].update(v or {})
        elif v not in (None, ""):
            cfg[k] = v
    key = stored.get("api_key") or (os.environ.get("ANTHROPIC_API_KEY") if cfg["provider"] == "anthropic" else os.environ.get("IH_AI_API_KEY", ""))
    cfg["has_key"] = bool(key)
    if include_secret:
        cfg["api_key"] = key
    else:
        cfg.pop("api_key", None)
    cfg["model"] = cfg.get("model") or MODEL_DEFAULTS.get(cfg["provider"], "")
    cfg["stats"] = dict(STATS)
    return cfg


def set_config(update: dict) -> dict:
    stored = db.get_setting("ai", {}) or {}
    for k in ("provider", "model", "base_url", "effort", "timeout"):
        if k in update:
            stored[k] = update[k]
    if update.get("api_key"):
        stored["api_key"] = update["api_key"]
    if update.get("clear_key"):
        stored.pop("api_key", None)
    if "features" in update:
        stored["features"] = {**stored.get("features", {}), **update["features"]}
    db.set_setting("ai", stored)
    return get_config()


class AIError(Exception):
    pass


class Provider:
    name = "offline"

    def __init__(self, cfg: dict):
        self.cfg = cfg

    @property
    def online(self) -> bool:
        return False

    def complete(self, system: str, prompt: str, max_tokens: int = 1500, json_mode: bool = False) -> str:
        raise AIError("offline")


class AnthropicProvider(Provider):
    name = "anthropic"

    @property
    def online(self) -> bool:
        return bool(self.cfg.get("api_key"))

    def complete(self, system: str, prompt: str, max_tokens: int = 1500, json_mode: bool = False) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=self.cfg.get("api_key"), timeout=self.cfg.get("timeout", 60), max_retries=1,
                                     **({"base_url": self.cfg["base_url"]} if self.cfg.get("base_url") else {}))
        kwargs = dict(model=self.cfg["model"], max_tokens=max(max_tokens, 1024), system=system,
                      messages=[{"role": "user", "content": prompt + ("\n\nRespond with a single JSON object only." if json_mode else "")}])
        if self.cfg.get("effort"):
            kwargs["output_config"] = {"effort": self.cfg["effort"]}
        try:
            # server-side refusal fallback keeps requests answerable when a model declines
            resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        except (TypeError, anthropic.BadRequestError):
            resp = client.messages.create(**kwargs)
        if getattr(resp, "stop_reason", None) == "refusal":
            raise AIError("model declined the request")
        return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")


class OpenAICompatProvider(Provider):
    name = "openai"

    @property
    def online(self) -> bool:
        return bool(self.cfg.get("base_url") or self.cfg.get("api_key"))

    def complete(self, system: str, prompt: str, max_tokens: int = 1500, json_mode: bool = False) -> str:
        import httpx
        base = (self.cfg.get("base_url") or "https://api.openai.com/v1").rstrip("/")
        body = {"model": self.cfg["model"], "max_tokens": max_tokens, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.cfg.get('api_key') or 'none'}"}
        r = httpx.post(f"{base}/chat/completions", json=body, headers=headers, timeout=self.cfg.get("timeout", 60))
        if r.status_code >= 400 and json_mode:
            body.pop("response_format", None)
            r = httpx.post(f"{base}/chat/completions", json=body, headers=headers, timeout=self.cfg.get("timeout", 60))
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


class OllamaProvider(Provider):
    name = "ollama"

    @property
    def online(self) -> bool:
        return True

    def complete(self, system: str, prompt: str, max_tokens: int = 1500, json_mode: bool = False) -> str:
        import httpx
        base = (self.cfg.get("base_url") or "http://localhost:11434").rstrip("/")
        body = {"model": self.cfg["model"], "stream": False, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "options": {"num_predict": max_tokens}}
        if json_mode:
            body["format"] = "json"
        r = httpx.post(f"{base}/api/chat", json=body, timeout=self.cfg.get("timeout", 120))
        r.raise_for_status()
        return r.json()["message"]["content"]


def get_provider() -> Provider:
    cfg = get_config(include_secret=True)
    p = cfg["provider"]
    if p == "anthropic":
        return AnthropicProvider(cfg)
    if p == "openai":
        return OpenAICompatProvider(cfg)
    if p == "ollama":
        return OllamaProvider(cfg)
    return Provider(cfg)


def feature_enabled(feature: str) -> bool:
    cfg = get_config()
    return cfg["provider"] != "offline" and cfg["features"].get(feature, True)


def generate(feature: str, system: str, prompt: str, max_tokens: int = 1500, json_mode: bool = False) -> str | None:
    """Return model text, or None when offline/disabled/failing (callers then use deterministic generators)."""
    if not feature_enabled(feature):
        return None
    prov = get_provider()
    if not prov.online:
        return None
    t0 = time.time()
    STATS["calls"] += 1
    try:
        out = prov.complete(system, prompt, max_tokens, json_mode)
        STATS["last_latency"] = round(time.time() - t0, 2)
        return out
    except Exception as e:  # network, auth, refusal, malformed: fall back silently
        STATS["failures"] += 1
        STATS["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
        log.warning("AI provider failed (%s): %s", feature, e)
        return None


def generate_json(feature: str, system: str, prompt: str, max_tokens: int = 2000) -> dict | None:
    txt = generate(feature, system, prompt, max_tokens, json_mode=True)
    if not txt:
        return None
    return parse_json(txt)


def parse_json(txt: str) -> dict | None:
    txt = txt.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.M).strip()
    try:
        v = json.loads(txt)
        return v if isinstance(v, dict) else {"items": v}
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", txt, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def test_connection() -> dict:
    prov = get_provider()
    if prov.name == "offline":
        return {"ok": True, "provider": "offline", "message": "Offline deterministic engine active."}
    if not prov.online:
        return {"ok": False, "provider": prov.name, "message": "No API key or endpoint configured."}
    try:
        t0 = time.time()
        out = prov.complete("You are a test endpoint.", "Reply with the JSON object {\"ok\": true}.", 50, json_mode=True)
        return {"ok": bool(parse_json(out or "")), "provider": prov.name, "latency": round(time.time() - t0, 2), "message": (out or "")[:200]}
    except Exception as e:
        return {"ok": False, "provider": prov.name, "message": f"{type(e).__name__}: {str(e)[:300]}"}
