"""SQLite persistence: campaigns, the event chronicle (with FTS5 retrieval), summaries, snapshots,
conversations, newspapers and settings."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import zlib
from pathlib import Path

FTS = os.environ.get("IH_FTS", "fts5")
DB_PATH = Path(os.environ.get("IH_DB", Path(__file__).resolve().parent.parent / "data" / "infinite_history.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT, scenario TEXT, player TEXT, year INTEGER, month INTEGER,
  created REAL, updated REAL, state BLOB, info TEXT, version INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, year INTEGER, month INTEGER, kind TEXT, title TEXT, body TEXT,
  actors TEXT, importance INTEGER, provinces TEXT, tags TEXT, thread TEXT, data TEXT, backstory INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ev_c_y ON events(campaign_id, year);
CREATE INDEX IF NOT EXISTS ev_c_imp ON events(campaign_id, importance);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, level TEXT, start_year INTEGER, end_year INTEGER,
  title TEXT, body TEXT, created REAL, source TEXT
);
CREATE INDEX IF NOT EXISTS sum_c ON summaries(campaign_id, start_year);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, year INTEGER, month INTEGER, label TEXT, kind TEXT,
  created REAL, state BLOB, last_event INTEGER
);
CREATE INDEX IF NOT EXISTS snap_c ON snapshots(campaign_id, year);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, country TEXT, role TEXT, text TEXT, year INTEGER, month INTEGER,
  secret INTEGER DEFAULT 0, created REAL, data TEXT
);
CREATE INDEX IF NOT EXISTS conv_c ON conversations(campaign_id, country);
CREATE TABLE IF NOT EXISTS newspapers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, year INTEGER, month INTEGER, country TEXT, data TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, kind TEXT, title TEXT, request TEXT, body TEXT, year INTEGER, created REAL, source TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
"""

_local = threading.local()
_init_lock = threading.Lock()
_initialized: set[str] = set()


def conn() -> sqlite3.Connection:
    path = str(DB_PATH)
    c = getattr(_local, "conn", None)
    if c is None or getattr(_local, "path", None) != path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(path, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=" + os.environ.get("IH_JOURNAL", "WAL"))
        c.execute("PRAGMA synchronous=NORMAL")
        _local.conn = c
        _local.path = path
        with _init_lock:
            if path not in _initialized:
                c.executescript(SCHEMA)
                if FTS == "fts5":
                    c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(title, body, actors, tags, content='events', content_rowid='id')")
                else:  # FTS4 fallback (e.g. SQLite under WebAssembly, where FTS5 is unavailable)
                    c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts4(title, body, actors, tags)")
                c.commit()
                _initialized.add(path)
    return c


def reset_for_tests(path: str) -> None:
    global DB_PATH
    DB_PATH = Path(path)
    _local.conn = None


def pack(state: dict) -> bytes:
    clean = {k: v for k, v in state.items() if not k.startswith("_")}
    return zlib.compress(json.dumps(clean, separators=(",", ":")).encode(), 6)


def unpack(blob: bytes) -> dict:
    return json.loads(zlib.decompress(blob).decode())


def save_campaign(cid: str, name: str, state: dict, info: dict | None = None) -> None:
    m = state["meta"]
    now = time.time()
    c = conn()
    c.execute("""INSERT INTO campaigns(id,name,scenario,player,year,month,created,updated,state,info,version)
                 VALUES(?,?,?,?,?,?,?,?,?,?,1)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, player=excluded.player, year=excluded.year, month=excluded.month,
                 updated=excluded.updated, state=excluded.state, info=excluded.info, version=campaigns.version+1""",
              (cid, name, m["scenario"], m.get("player"), m["year"], m["month"], now, now, pack(state), json.dumps(info or {})))
    c.commit()


def load_campaign(cid: str) -> tuple[dict, dict] | None:
    r = conn().execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
    if not r:
        return None
    return unpack(r["state"]), {k: r[k] for k in ("id", "name", "scenario", "player", "year", "month", "created", "updated", "version")} | {"info": json.loads(r["info"] or "{}")}


def list_campaigns() -> list[dict]:
    rows = conn().execute("SELECT id,name,scenario,player,year,month,created,updated,info FROM campaigns ORDER BY updated DESC").fetchall()
    return [dict(r) | {"info": json.loads(r["info"] or "{}")} for r in rows]


def delete_campaign(cid: str) -> None:
    c = conn()
    ids = [r[0] for r in c.execute("SELECT id FROM events WHERE campaign_id=?", (cid,))]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        rows = c.execute(f"SELECT id,title,body,actors,tags FROM events WHERE id IN ({','.join('?' * len(chunk))})", chunk).fetchall()
        fts_delete(c, rows)
    for t in ("events", "summaries", "snapshots", "conversations", "newspapers", "documents"):
        c.execute(f"DELETE FROM {t} WHERE campaign_id=?", (cid,))
    c.execute("DELETE FROM campaigns WHERE id=?", (cid,))
    c.commit()


def fts_insert(c, rid, title, body, actors, tags) -> None:
    if FTS == "fts5":
        c.execute("INSERT INTO events_fts(rowid,title,body,actors,tags) VALUES(?,?,?,?,?)", (rid, title, body, actors, tags))
    else:
        c.execute("INSERT INTO events_fts(docid,title,body,actors,tags) VALUES(?,?,?,?,?)", (rid, title, body, actors, tags))


def fts_delete(c, rows) -> None:
    if FTS == "fts5":
        c.executemany("INSERT INTO events_fts(events_fts,rowid,title,body,actors,tags) VALUES('delete',?,?,?,?,?)",
                      [(r["id"], r["title"], r["body"], r["actors"], r["tags"]) for r in rows])
    else:
        c.executemany("DELETE FROM events_fts WHERE docid=?", [(r["id"],) for r in rows])


def get_setting(key: str, default=None):
    r = conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def set_setting(key: str, value) -> None:
    c = conn()
    c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))
    c.commit()
