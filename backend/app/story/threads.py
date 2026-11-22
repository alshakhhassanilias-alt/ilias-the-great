"""Story threads: persistent storylines (wars, resistance movements, succession crises, Earth-Mars tension...)
that give events and missions their causes and continuity."""
from __future__ import annotations


def open_thread(state: dict, kind: str, title: str, summary: str, actors: list[str], key: str | None = None,
                provinces: list[str] | None = None, tension: float = 30.0, data: dict | None = None) -> dict:
    key = key or f"{kind}:{'-'.join(actors)}"
    for th in state["threads"].values():
        if th["key"] == key and th["status"] == "active":
            return th
    from ..world.scenario import next_id
    tid = next_id(state, "th")
    th = {"id": tid, "kind": kind, "key": key, "title": title, "summary": summary, "actors": actors,
          "provinces": provinces or [], "tension": tension, "status": "active", "started": state["meta"]["year"],
          "ended": None, "beats": [{"y": state["meta"]["year"], "t": title}], "data": data or {}}
    state["threads"][tid] = th
    return th


def close_thread(state: dict, tid: str, resolution: str) -> None:
    th = state["threads"].get(tid)
    if not th or th["status"] != "active":
        return
    th["status"] = "resolved"
    th["ended"] = state["meta"]["year"]
    th["resolution"] = resolution
    th["beats"].append({"y": state["meta"]["year"], "t": resolution})


def find_thread(state: dict, key: str) -> dict | None:
    for th in state["threads"].values():
        if th["key"] == key and th["status"] == "active":
            return th
    return None


def active_threads(state: dict, actor: str | None = None) -> list[dict]:
    return [th for th in state["threads"].values() if th["status"] == "active" and (actor is None or actor in th["actors"])]


def prune_threads(state: dict, keep_resolved: int = 300) -> None:
    resolved = sorted((th for th in state["threads"].values() if th["status"] != "active"), key=lambda t: t["ended"] or 0)
    for th in resolved[:-keep_resolved]:
        del state["threads"][th["id"]]
