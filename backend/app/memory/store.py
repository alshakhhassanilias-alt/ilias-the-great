"""Persistent historical memory: the full chronicle of events, compressed summaries at decade/century level,
and a retrieval system (FTS5/BM25 + importance + entity matching + anniversary awareness) used before any
content is generated, so events from centuries ago can still shape the present."""
from __future__ import annotations

import json
import re
import time
from collections import Counter, defaultdict

from .. import db


def _actors_field(actors: list[str]) -> str:
    return " " + " ".join(actors) + " " if actors else ""


def add_events(cid: str, events: list[dict], backstory: bool = False) -> list[int]:
    if not events:
        return []
    c = db.conn()
    ids = []
    for e in events:
        cur = c.execute("""INSERT INTO events(campaign_id,year,month,kind,title,body,actors,importance,provinces,tags,thread,data,backstory)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (cid, e["year"], e.get("month", 1), e["kind"], e["title"], e.get("body", ""), _actors_field(e.get("actors", [])),
                         int(e.get("importance", 2)), ",".join(e.get("provinces", [])[:30]), " ".join(e.get("tags", [])), e.get("thread"),
                         json.dumps(e.get("data", {})), 1 if backstory or e.get("backstory") else 0))
        rid = cur.lastrowid
        ids.append(rid)
        db.fts_insert(c, rid, e["title"], e.get("body", ""), _actors_field(e.get("actors", [])), " ".join(e.get("tags", [])))
    c.commit()
    return ids


def row_to_event(r) -> dict:
    return {"id": r["id"], "year": r["year"], "month": r["month"], "kind": r["kind"], "title": r["title"], "body": r["body"],
            "actors": (r["actors"] or "").split(), "importance": r["importance"], "provinces": [p for p in (r["provinces"] or "").split(",") if p],
            "tags": (r["tags"] or "").split(), "thread": r["thread"], "data": json.loads(r["data"] or "{}"), "backstory": bool(r["backstory"])}


def query_events(cid: str, q: str | None = None, year_from: int | None = None, year_to: int | None = None, actor: str | None = None,
                 kinds: list[str] | None = None, min_importance: int = 0, limit: int = 200, offset: int = 0, order: str = "desc",
                 thread: str | None = None) -> list[dict]:
    c = db.conn()
    where = ["e.campaign_id=?"]
    args: list = [cid]
    if year_from is not None:
        where.append("e.year>=?")
        args.append(year_from)
    if year_to is not None:
        where.append("e.year<=?")
        args.append(year_to)
    if actor:
        where.append("e.actors LIKE ?")
        args.append(f"% {actor} %")
    if kinds:
        where.append(f"e.kind IN ({','.join('?' * len(kinds))})")
        args += kinds
    if min_importance:
        where.append("e.importance>=?")
        args.append(min_importance)
    if thread:
        where.append("e.thread=?")
        args.append(thread)
    od = "DESC" if order == "desc" else "ASC"
    if q and q.strip():
        fq = fts_query(q)
        if fq:
            if db.FTS == "fts5":
                sql = f"""SELECT e.* FROM events_fts f JOIN events e ON e.id=f.rowid WHERE events_fts MATCH ? AND {' AND '.join(where)}
                          ORDER BY bm25(events_fts) LIMIT ? OFFSET ?"""
            else:
                sql = f"""SELECT e.* FROM events_fts f JOIN events e ON e.id=f.docid WHERE events_fts MATCH ? AND {' AND '.join(where)}
                          ORDER BY e.importance DESC, e.year DESC LIMIT ? OFFSET ?"""
            return [row_to_event(r) for r in c.execute(sql, [fq] + args + [limit, offset]).fetchall()]
    sql = f"SELECT e.* FROM events e WHERE {' AND '.join(where)} ORDER BY e.year {od}, e.month {od}, e.id {od} LIMIT ? OFFSET ?"
    return [row_to_event(r) for r in c.execute(sql, args + [limit, offset]).fetchall()]


STOP = set("the a an of to in on and or for with by at from is are was were be been it its this that what why how who when which as into our we us their they them my me i you your".split())


def fts_query(text: str) -> str:
    words = [w for w in re.findall(r"[A-Za-z0-9]{3,}", text.lower()) if w not in STOP][:12]
    if not words:
        return ""
    return " OR ".join(f'"{w}"*' if len(w) > 4 else f'"{w}"' for w in words)


def count_events(cid: str) -> int:
    return db.conn().execute("SELECT COUNT(*) FROM events WHERE campaign_id=?", (cid,)).fetchone()[0]


def retrieve(cid: str, query: str, actors: list[str] | None = None, year: int | None = None, k: int = 12) -> dict:
    """Retrieve the most relevant historical knowledge for generating new content."""
    scored: dict[int, tuple[float, dict]] = {}
    if query:
        for rank, e in enumerate(query_events(cid, q=query, limit=60)):
            scored[e["id"]] = (60 - rank + e["importance"] * 8, e)
    for a in (actors or [])[:4]:
        for e in query_events(cid, actor=a, min_importance=4, limit=25):
            s = scored.get(e["id"], (0, e))[0] + 20 + e["importance"] * 5
            scored[e["id"]] = (s, e)
    for e in query_events(cid, min_importance=5, limit=20):
        s = scored.get(e["id"], (0, e))[0] + 15
        scored[e["id"]] = (s, e)
    if year is not None:
        for e in query_events(cid, min_importance=4, limit=400):
            age = year - e["year"]
            if age in (50, 100, 150, 200, 250, 300, 500, 1000):
                s = scored.get(e["id"], (0, e))[0] + 25
                scored[e["id"]] = (s, e)
    top = [e for _, e in sorted(scored.values(), key=lambda x: -x[0])[:k]]
    top.sort(key=lambda e: (e["year"], e["month"]))
    sums = list_summaries(cid)
    q = set(re.findall(r"[a-z]{4,}", (query or "").lower()))
    rel = sorted(sums, key=lambda s: -(len(q & set(re.findall(r"[a-z]{4,}", (s["title"] + " " + s["body"]).lower()))) + (2 if s["level"] != "decade" else 0)))
    return {"events": top, "summaries": rel[:4]}


def add_summary(cid: str, level: str, start: int, end: int, title: str, body: str, source: str = "offline") -> None:
    c = db.conn()
    c.execute("INSERT INTO summaries(campaign_id,level,start_year,end_year,title,body,created,source) VALUES(?,?,?,?,?,?,?,?)",
              (cid, level, start, end, title, body, time.time(), source))
    c.commit()


def list_summaries(cid: str, level: str | None = None) -> list[dict]:
    sql = "SELECT * FROM summaries WHERE campaign_id=?" + (" AND level=?" if level else "") + " ORDER BY start_year, id"
    args = (cid, level) if level else (cid,)
    return [dict(r) for r in db.conn().execute(sql, args).fetchall()]


def summary_exists(cid: str, level: str, start: int) -> bool:
    return db.conn().execute("SELECT 1 FROM summaries WHERE campaign_id=? AND level=? AND start_year=?", (cid, level, start)).fetchone() is not None


def compose_period_summary(state: dict, events: list[dict], start: int, end: int, label: str) -> tuple[str, str]:
    """Deterministic compression of a period's events into a readable historical summary."""
    cn = lambda t: state["countries"].get(t, {}).get("name", t)
    if not events:
        return f"{label} {start}-{end}", "A quiet period with no events of lasting significance."
    imp = sorted(events, key=lambda e: (-e["importance"], e["year"]))
    by_kind = defaultdict(list)
    for e in events:
        by_kind[e["kind"]].append(e)
    actors = Counter(a for e in events if e["importance"] >= 3 for a in e["actors"])
    main = [cn(a) for a, _ in actors.most_common(4)]
    parts = []
    wars = [e for e in by_kind.get("war", []) if e["title"].startswith("War:") or "World War" in e["title"]]
    ends = by_kind.get("war_end", [])
    if wars:
        parts.append(f"War shaped these years: {', '.join(sorted({e['title'].replace('War: ', '').replace(' begins', '') for e in wars})[:4])}.")
    if ends:
        parts.append(" ".join(e["body"].split(". ")[0] + "." for e in ends[:3]))
    falls = [e for e in events if e["kind"] in ("collapse",)]
    if falls:
        parts.append("States vanished from the map: " + ", ".join(e["title"].replace(" ceases to exist", "") for e in falls[:5]) + ".")
    newst = [e for e in events if e["kind"] in ("independence", "restoration", "revolt")]
    if newst:
        parts.append("New states emerged: " + ", ".join(e["title"].split(" declares")[0].split(" wins")[0].split(" becomes")[0].split(" gains")[0].split(" is restored")[0] for e in newst[:6]) + ".")
    sci = [e for e in by_kind.get("science", []) if e.get("data", {}).get("first")]
    if sci:
        parts.append("Scientific frontiers: " + "; ".join(e["title"].replace("World first: ", "") for e in sci[:6]) + ".")
    gov = by_kind.get("government", []) + by_kind.get("civil_war", [])
    if gov:
        parts.append("Political upheaval: " + "; ".join(e["title"] for e in gov[:4]) + ".")
    soc = by_kind.get("society", []) + by_kind.get("ideology", []) + by_kind.get("law", [])
    if soc:
        parts.append("Society and ideas: " + "; ".join(e["title"] for e in soc[:4]) + ".")
    space = by_kind.get("space", [])
    if space:
        parts.append("Beyond Earth: " + "; ".join(e["title"] for e in space[:4]) + ".")
    era = by_kind.get("era", []) + by_kind.get("chapter", [])
    if era:
        parts.append("Turning points: " + "; ".join(e["title"] for e in era[:3]) + ".")
    if not parts:
        parts = [f"{e['year']}: {e['title']}." for e in imp[:6]]
    title = f"{label} {start}–{end}" + (f": {imp[0]['title']}" if imp and imp[0]['importance'] >= 4 else "")
    lead = f"The principal actors were {', '.join(main)}. " if main else ""
    return title, lead + " ".join(parts)


def summarize_decades(cid: str, state: dict) -> list[dict]:
    """Create compressed summaries for every completed decade (and century) not yet summarised."""
    made = []
    start_year = state["meta"]["start_year"]
    year = state["meta"]["year"]
    d0 = (start_year // 10) * 10
    for d in range(d0, (year // 10) * 10, 10):
        if d + 9 >= year or summary_exists(cid, "decade", d):
            continue
        evs = [e for e in query_events(cid, year_from=d, year_to=d + 9, min_importance=3, limit=400, order="asc") if not e["backstory"]]
        title, body = compose_period_summary(state, evs, d, d + 9, "The decade")
        add_summary(cid, "decade", d, d + 9, title, body)
        made.append({"level": "decade", "start": d, "title": title, "body": body})
    c0 = (start_year // 100) * 100
    for cs in range(c0, (year // 100) * 100, 100):
        if cs + 99 >= year or summary_exists(cid, "century", cs):
            continue
        evs = [e for e in query_events(cid, year_from=cs, year_to=cs + 99, min_importance=4, limit=600, order="asc") if not e["backstory"]]
        title, body = compose_period_summary(state, evs, cs, cs + 99, "The century")
        add_summary(cid, "century", cs, cs + 99, title, body)
        made.append({"level": "century", "start": cs, "title": title, "body": body})
    return made


def seed_backstory(cid: str, state: dict) -> None:
    """Record the established history that precedes the campaign start."""
    evs = []
    seen = set()
    for t, c in state["countries"].items():
        for m in c["memories"]:
            if not m.get("hist"):
                continue
            key = (m["y"], m["text"][:40])
            if key in seen:
                continue
            seen.add(key)
            evs.append({"year": m["y"], "month": 1, "kind": "history", "title": m["text"].split(";")[0][:90], "body": m["text"],
                        "actors": [t, m["other"]], "importance": 4 if abs(m["w"]) >= 40 else 3, "tags": ["backstory", m["kind"]]})
    for e in state["meta"].get("backstory_events", []):
        evs.append({"year": e["y"], "month": 1, "kind": "history", "title": e["title"], "body": e["text"], "actors": e["actors"],
                    "importance": 5 if e["kind"] in ("founding", "collapse") else 3, "tags": ["backstory", e["kind"]]})
    for t, c in state["countries"].items():
        if c.get("origin") and c["alive"] and len(c["origin"]) > 60:
            evs.append({"year": state["meta"]["start_year"], "month": 0, "kind": "history", "title": f"Origins of {c['name']}", "body": c["origin"],
                        "actors": [t], "importance": 3, "tags": ["backstory", "origin"]})
    evs.sort(key=lambda e: e["year"])
    add_events(cid, evs, backstory=True)
