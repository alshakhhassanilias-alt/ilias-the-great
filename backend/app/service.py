"""Campaign service: the single gateway between the API, the deterministic simulation, historical memory,
AI providers and persistence. All AI proposals pass through validation here."""
from __future__ import annotations

import json
import re
import threading
import time
import uuid

from . import db
from .ai.context import build_context
from .ai.providers import feature_enabled, generate_json
from .memory import store
from .orders.actions import ACTION_TYPES, assess
from .orders.executor import execute_actions
from .orders.parser import describe, interpret as offline_interpret
from .sim.core import allies, alive, build_index, total_power, world_totals
from .sim.economy import aggregate
from .sim.engine import advance as engine_advance, create_world, set_player
from .story import advisor, diplomacy, narrative
from .story.decisions import resolve_decision
from .story.missions import COND_TYPES, add_mission, evaluate
from .util import rng_for
from .world.geo import get_geo
from .world.ideologies import get_ideology
from .world.techtree import all_techs, available

_cache: dict[str, tuple[dict, dict]] = {}
_locks: dict[str, threading.RLock] = {}
_glock = threading.Lock()


class NotFound(Exception):
    pass


def lock(cid: str) -> threading.RLock:
    with _glock:
        return _locks.setdefault(cid, threading.RLock())


def load(cid: str) -> tuple[dict, dict]:
    if cid in _cache:
        return _cache[cid]
    r = db.load_campaign(cid)
    if not r:
        raise NotFound(cid)
    state, info = r
    build_index(state)
    _cache[cid] = (state, info)
    if len(_cache) > 6:
        _cache.pop(next(iter(_cache)))
    return state, info


def persist(cid: str, state: dict, info: dict) -> None:
    c = state["countries"].get(state["meta"].get("player") or "", {})
    info["name"] = info.get("name") or "Campaign"
    meta = {"country": c.get("name"), "color": c.get("color"), "era": state["meta"].get("era"), "phase": state["meta"].get("phase_label"),
            "scenario_name": state["meta"].get("scenario_name"), "start_year": state["meta"]["start_year"]}
    db.save_campaign(cid, info["name"], state, meta)
    _cache[cid] = (state, info)


def flush(cid: str, state: dict) -> list[dict]:
    evs = state.get("pending_events", [])
    state["pending_events"] = []
    ids = store.add_events(cid, evs)
    for e, i in zip(evs, ids):
        e["id"] = i
    return evs


def snapshot(cid: str, state: dict, label: str, kind: str = "auto") -> int:
    c = db.conn()
    last = c.execute("SELECT MAX(id) FROM events WHERE campaign_id=?", (cid,)).fetchone()[0] or 0
    cur = c.execute("INSERT INTO snapshots(campaign_id,year,month,label,kind,created,state,last_event) VALUES(?,?,?,?,?,?,?,?)",
                    (cid, state["meta"]["year"], state["meta"]["month"], label, kind, time.time(), db.pack(state), last))
    c.commit()
    return cur.lastrowid


# ------------------------------------------------------------------ creation

def create_campaign(scenario: str, country: str | None, name: str | None = None, year: int | None = None, divergence: str = "",
                    settings: dict | None = None, seed: int | None = None) -> str:
    settings = dict(settings or {})
    settings.setdefault("pause_on_decision", True)
    settings["divergence"] = divergence
    seed = seed if seed is not None else int(time.time() * 1000) % 2_000_000_000
    state = create_world(scenario, seed, settings, year)
    tags = [t for t, c in state["countries"].items() if c["alive"]]
    if not country or country not in state["countries"]:
        country = max(tags, key=lambda t: state["countries"][t]["gdp"])
    cid = uuid.uuid4().hex[:12]
    state["meta"]["campaign_id"] = cid
    set_player(state, country)
    store.seed_backstory(cid, state)
    if divergence:
        from .story.divergence import apply_divergence
        apply_divergence(state, divergence, rng_for(seed, "divergence"))
        aggregate(state)
        set_player(state, country)
    c = state["countries"][country]
    from .sim.core import emit
    emit(state, "campaign", f"The campaign begins: {c['name']}, {state['meta']['year']}", f"{c['leader']['name']}, {c['leader']['title']} of {c['name']}, takes up the reins of state. {state['meta'].get('world_background', '')[:300]}",
         [country], 4, tags=["campaign"])
    state["milestones"].append({"y": state["meta"]["year"], "title": f"Beginning of the {c['adj']} campaign", "actors": [country], "kind": "campaign"})
    flush(cid, state)
    info = {"name": name or f"{c['name']} {state['meta']['year']}"}
    persist(cid, state, info)
    snapshot(cid, state, f"Start: {c['name']} {state['meta']['year']}", "auto")
    return cid


def scenario_countries(scenario: str, year: int | None = None, seed: int = 1) -> list[dict]:
    state = create_world(scenario, seed, {}, year)
    tot = world_totals(state)
    out = []
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        out.append({"tag": t, "name": c["name"], "color": c["color"], "gov": c["gov"], "ideology": get_ideology(state, c["ideology"])["name"],
                    "leader": c["leader"]["name"], "gdp_share": round(c["gdp"] / tot["gdp"], 4), "pop": round(c["pop"], 1),
                    "power": round(total_power(c), 2), "subject_of": c.get("overlord"), "provinces": len([1 for p in state["provinces"].values() if p["owner"] == t])})
    out.sort(key=lambda x: -x["power"])
    return out


# ------------------------------------------------------------------ views

def province_view(state: dict) -> dict:
    out = {}
    for pid, p in state["provinces"].items():
        out[pid] = [p["owner"], p["ctrl"], round(p["unrest"]), round(p["pop"], 4), round(p["gpc"]), round(p["integ"]), p["body"],
                    1 if p["owner"] and p["owner"] in p["cores"] else 0, round(p.get("autonomy_desire", 0))]
    return out


def country_summary(state: dict, t: str, full: bool = False) -> dict:
    c = state["countries"][t]
    ide = get_ideology(state, c["ideology"])
    d = {"tag": t, "name": c["name"], "adj": c["adj"], "color": c["color"], "alive": c["alive"], "gov": c["gov"], "ideology": ide["name"],
         "ideology_id": ide["id"], "leader": c["leader"], "gdp": round(c["gdp"], 3), "pop": round(c["pop"], 3), "stability": round(c["stability"], 1),
         "overlord": c.get("overlord"), "power": round(total_power(c), 2), "capital": c["capital"], "home": c["home"], "founded": c.get("founded"),
         "fell": c.get("fell")}
    if full:
        at = all_techs(state)
        d.update({"legitimacy": round(c["legitimacy"], 1), "war_support": round(c.get("war_support", 50), 1), "exhaustion": round(c.get("exhaustion", 0), 1),
                  "treasury": round(c["treasury"], 2), "debt": round(c["debt"], 2), "budget": c["budget"], "army": round(c["army"]), "navy": round(c["navy"]),
                  "air": round(c["air"]), "space": round(c.get("space", 0)), "nukes": c.get("nukes", 0), "mil_mix": c["mil_mix"],
                  "techs": c["techs"], "research": {**c["research"], "name": at.get(c["research"].get("target") or "", {}).get("name"), "rate": round(c.get("rp_rate", 0), 3)},
                  "focus": c.get("focus"), "policies": c["policies"], "laws": c["laws"][-30:], "pops": c["pops"], "flags": {k: v for k, v in c["flags"].items() if not isinstance(v, dict)},
                  "origin": c.get("origin"), "heritage": c.get("heritage"), "predecessors": c.get("predecessors"), "ambitions": c.get("ambitions"),
                  "memories": sorted(c["memories"], key=lambda m: -m["y"])[:40], "claims": len(c["claims"]), "projects": c["projects"], "gpc": round(c.get("gpc", 0)),
                  "ideology_desc": ide["desc"], "dynasty": c.get("dynasty"), "faith": c.get("faith"), "mods": {k: v for k, v in c.get("mods", {}).items() if k != "unlocks"},
                  "unlocks": c.get("mods", {}).get("unlocks", [])})
    return d


def _visible_threads(state: dict) -> list[dict]:
    p = state["meta"].get("player")
    act = [th for th in state["threads"].values() if th["status"] == "active"]
    mine = [th for th in act if p in th["actors"]]
    big = {t for t in sorted(alive(state), key=lambda t: -total_power(state["countries"][t]))[:8]}
    world = [th for th in act if p not in th["actors"] and (th["kind"] in ("war", "successor_age", "restoration") or set(th["actors"]) & big)]
    return sorted(mine, key=lambda th: -th["tension"])[:25] + sorted(world, key=lambda th: -th["tension"])[:12]


def view(cid: str, include_provinces: bool = True) -> dict:
    state, info = load(cid)
    m = state["meta"]
    p = m.get("player")
    vis_treaties = [t for t in state["treaties"] if not t.get("secret") or p in t["members"]]
    out = {
        "id": cid, "name": info.get("name"), "meta": {k: v for k, v in m.items() if k not in ("backstory_events", "anniv_done", "emergent")},
        "player": country_summary(state, p, full=True) if p and p in state["countries"] else None,
        "countries": {t: country_summary(state, t) for t, c in state["countries"].items() if c["alive"] or c.get("fell") and m["year"] - c["fell"] < 300},
        "wars": state["wars"], "treaties": vis_treaties, "orgs": list(state["orgs"].values()),
        "missions": [x for x in state["missions"].values() if not x.get("hidden")][-80:],
        "hidden_missions": sum(1 for x in state["missions"].values() if x.get("hidden") and x["status"] == "active"),
        "threads": _visible_threads(state),
        "decisions": [d for d in state["decisions"] if d.get("owner") == p],
        "bodies": state["bodies"], "extra_geo": state.get("extra_geo", {}),
        "history": {t: v for t, v in state.get("history", {}).items() if t == p or t in [x for x in sorted(alive(state), key=lambda t: -state['countries'][t]['gdp'])[:6]]},
        "world": {"gdp": round(world_totals(state)["gdp"], 2), "pop": round(world_totals(state)["pop"], 2), "countries": len(alive(state)),
                  "dig": round(sum(c["pops"].get("dig", 0) for c in state["countries"].values() if c["alive"]), 2),
                  "offworld": round(sum(x["pop"] for x in state["provinces"].values() if x["body"] != "earth" and x["owner"]), 4)},
        "milestones": state["milestones"][-200:],
        "ideologies": {k: {"name": v["name"], "family": v["family"], "desc": v["desc"], "custom": v.get("custom"), "origin": v.get("origin"), "year": v.get("year"),
                           "supporters": v.get("supporters"), "opponents": v.get("opponents"), "economy": v.get("economy"), "axes": v.get("axes")}
                       for k, v in state["ideologies"].items() if v.get("custom") or any(c["ideology"] == k for c in state["countries"].values() if c["alive"])},
        "faiths": state.get("faiths", {}),
        "recent_events": store.query_events(cid, limit=60),
    }
    if include_provinces:
        out["provinces"] = province_view(state)
    if p:
        out["relations"] = {t: [round(v, 1) for v in state.get("opinions", {}).get(f"{t}>{p}", [0, 50])] for t in state["countries"] if t != p and state["countries"][t]["alive"]}
    return out


# ------------------------------------------------------------------ time

def advance(cid: str, months: int) -> dict:
    months = max(1, min(int(months), 12 * 2000))
    with lock(cid):
        state, info = load(cid)
        year0 = state["meta"]["year"]
        phase0 = state["meta"].get("phase")
        new_events: list[dict] = []

        def on_year(st):
            new_events.extend(flush(cid, st))
            store.summarize_decades(cid, st)
            y = st["meta"]["year"]
            span = y - st["meta"]["start_year"]
            if (span <= 100 and y % 10 == 0) or (y % 50 == 0):
                snapshot(cid, st, f"{y}", "auto")
        res = engine_advance(state, months, on_year=on_year)
        new_events += flush(cid, state)
        store.summarize_decades(cid, state)
        if feature_enabled("missions") and (state["meta"].get("phase") != phase0 or sum(1 for x in state["missions"].values() if x["status"] == "active") < 4):
            ai_missions(cid, state)
            new_events += flush(cid, state)
        persist(cid, state, info)
        p = state["meta"].get("player")
        popups = [e for e in new_events if e["importance"] >= 5 or (e["importance"] >= 4 and p in e["actors"])][-12:]
        return {"result": res, "from": year0, "to": state["meta"]["year"], "events": new_events[-150:], "popups": popups, "event_count": len(new_events)}


def ai_missions(cid: str, state: dict) -> int:
    p = state["meta"]["player"]
    ctx = build_context(state, cid, query="crisis mission objective")
    tags = ", ".join(f"{t}={state['countries'][t]['name']}" for t in sorted(alive(state), key=lambda t: -total_power(state['countries'][t]))[:30])
    out = generate_json("missions", "You design missions for a grand-strategy history sandbox. Missions must emerge from the current situation and history. Return JSON {\"missions\":[{\"title\",\"category\",\"desc\",\"importance\",\"objectives\":[{\"text\",\"cond\"}],\"mode\":\"all|any\",\"rewards\":{...},\"reward_text\",\"deadline\":year,\"optional\":true}]}. "
                        f"cond must be one of these machine-checkable forms: {sorted(COND_TYPES)} e.g. {{\"t\":\"gdp\",\"min\":1000}}, {{\"t\":\"stability\",\"min\":60}}, {{\"t\":\"tech\",\"tech\":ID}}, {{\"t\":\"treaty\",\"target\":TAG}}, {{\"t\":\"power_ratio\",\"target\":TAG,\"min\":1.5}}, {{\"t\":\"colony\",\"body\":\"mars\",\"min_pop\":0.1}}, {{\"t\":\"policy\",\"policy\":\"digital_rights\",\"value\":\"equal\"}}. rewards keys: stability, legitimacy, treasury_gdp, research_boost, prod. Max 2 missions.",
                        f"{ctx}\nCOUNTRY TAGS: {tags}\nAVAILABLE TECH IDS: {[t['id'] for t in available(state, set(state['countries'][p]['techs']))][:15]}", 2000)
    n = 0
    if out and isinstance(out.get("missions"), list):
        for mm in out["missions"][:2]:
            if isinstance(mm, dict):
                mm["key"] = "ai:" + str(mm.get("title", ""))[:60]
                if add_mission(state, mm, source="ai"):
                    n += 1
    return n


# ------------------------------------------------------------------ orders

def interpret(cid: str, text: str) -> dict:
    state, _ = load(cid)
    p = state["meta"]["player"]
    plan = None
    if feature_enabled("orders"):
        tags = "; ".join(f"{t}={c['name']}" for t, c in state["countries"].items() if c["alive"])
        out = generate_json("orders", "You translate a head of state's natural-language order into structured actions for a history simulation. "
                            f"Action types: {json.dumps(ACTION_TYPES)}. Return JSON {{\"actions\":[{{\"type\":..., ...params}}], \"notes\": string, \"clarify\": null or a question if the order is genuinely ambiguous}}. "
                            "Use country TAGS for targets, province ids only if given. Never turn a narrative wish into an instant impossible result: long-term goals become research, national_initiative (name, effects{stability,prod,research,integration,unrest}, years, cost_share) or strategic_goal.",
                            f"{build_context(state, cid, query=text)}\nCOUNTRIES: {tags[:5000]}\nORDER: {text}", 1500)
        if out and isinstance(out.get("actions"), list):
            acts = [a for a in out["actions"] if isinstance(a, dict) and a.get("type") in ACTION_TYPES]
            if acts or out.get("clarify"):
                plan = {"text": text, "actions": [], "notes": [str(out.get("notes") or "")] if out.get("notes") else [], "clarify": out.get("clarify"), "interpreter": "ai"}
                for a in acts[:8]:
                    plan["actions"].append({**a, "assessment": assess(state, p, dict(a)), "summary": describe(state, a)})
    if not plan:
        plan = offline_interpret(state, p, text)
    return plan


def execute(cid: str, text: str, actions: list[dict] | None = None) -> dict:
    with lock(cid):
        state, info = load(cid)
        p = state["meta"]["player"]
        if actions is None:
            actions = [{k: v for k, v in a.items() if k not in ("assessment", "summary")} for a in interpret(cid, text)["actions"]]
        else:
            actions = [{k: v for k, v in a.items() if k not in ("assessment", "summary")} for a in actions if isinstance(a, dict) and a.get("type") in ACTION_TYPES]
        rng = rng_for(state["meta"]["seed"], "order", state["meta"]["tick"], text)
        res = execute_actions(state, p, actions, rng, source="player", text=text)
        build_index(state)
        aggregate(state)
        from .story.missions import check_missions
        check_missions(state, p, rng)
        res["events"] = flush(cid, state)
        persist(cid, state, info)
        return res


def decide(cid: str, did: str, option: str) -> dict:
    with lock(cid):
        state, info = load(cid)
        rng = rng_for(state["meta"]["seed"], "decision", did, option)
        res = resolve_decision(state, did, option, rng)
        aggregate(state)
        res["events"] = flush(cid, state)
        persist(cid, state, info)
        return res


def switch_country(cid: str, tag: str) -> dict:
    with lock(cid):
        state, info = load(cid)
        if not state["countries"].get(tag, {}).get("alive"):
            return {"ok": False, "error": "That state does not exist."}
        old = state["meta"].get("player")
        set_player(state, tag)
        from .sim.core import emit
        emit(state, "campaign", f"The story continues with {state['countries'][tag]['name']}", f"The chronicle now follows {state['countries'][tag]['name']}" + (f", after {state['countries'][old]['name']}." if old in state["countries"] else "."), [tag], 4)
        flush(cid, state)
        persist(cid, state, info)
        return {"ok": True}


# ------------------------------------------------------------------ diplomacy, advisor, narrative

def talk(cid: str, tag: str, message: str, secret: bool = False) -> dict:
    with lock(cid):
        state, info = load(cid)
        p = state["meta"]["player"]
        if tag not in state["countries"] or not state["countries"][tag]["alive"] or tag == p:
            return {"error": "Invalid counterpart."}
        hist = conversation(cid, tag)
        rng = rng_for(state["meta"]["seed"], "talk", state["meta"]["tick"], tag, len(hist))
        out = diplomacy.talk(state, p, tag, message, secret, rng, hist)
        c = db.conn()
        y, mo = state["meta"]["year"], state["meta"]["month"]
        c.execute("INSERT INTO conversations(campaign_id,country,role,text,year,month,secret,created,data) VALUES(?,?,?,?,?,?,?,?,?)",
                  (cid, tag, "player", message, y, mo, 1 if secret else 0, time.time(), "{}"))
        c.execute("INSERT INTO conversations(campaign_id,country,role,text,year,month,secret,created,data) VALUES(?,?,?,?,?,?,?,?,?)",
                  (cid, tag, "leader", out["reply"], y, mo, 1 if secret else 0, time.time(), json.dumps({"outcome": out["outcome"], "leader": out["leader"]})))
        c.commit()
        if out["outcome"].get("effects"):
            from .sim.core import emit
            emit(state, "diplomacy_talk", f"Talks with {state['countries'][tag]['name']}", f"{'Secret ' if secret else ''}negotiations with {out['leader']['name']}: {'; '.join(out['outcome']['effects'])}.",
                 [p, tag], 2, tags=["diplomacy"] + (["secret"] if secret else []))
        out["events"] = flush(cid, state)
        persist(cid, state, info)
        return out


def conversation(cid: str, tag: str) -> list[dict]:
    rows = db.conn().execute("SELECT * FROM conversations WHERE campaign_id=? AND country=? ORDER BY id", (cid, tag)).fetchall()
    return [{"role": r["role"], "text": r["text"], "year": r["year"], "month": r["month"], "secret": bool(r["secret"]), "data": json.loads(r["data"] or "{}")} for r in rows]


def country_detail(cid: str, tag: str) -> dict:
    state, _ = load(cid)
    if tag not in state["countries"]:
        raise NotFound(tag)
    d = country_summary(state, tag, full=True)
    p = state["meta"]["player"]
    from .sim.relations import opinion, trust
    if p and tag != p:
        d["opinion_of_player"] = round(opinion(state, tag, p), 1)
        d["player_opinion"] = round(opinion(state, p, tag), 1)
        d["trust"] = round(trust(state, tag, p), 1)
    d["allies"] = sorted(allies(state, tag))
    d["treaties"] = [t for t in state["treaties"] if tag in t["members"] and (not t.get("secret") or p in t["members"])]
    d["wars"] = [w["name"] for w in state["wars"] if tag in w["att"] + w["def"]]
    d["intel"] = state.get("intel", {}).get(tag)
    d["provinces"] = sum(1 for x in state["provinces"].values() if x["owner"] == tag)
    d["events"] = store.query_events(cid, actor=tag, min_importance=3, limit=30)
    return d


def tech_view(cid: str) -> dict:
    state, _ = load(cid)
    p = state["meta"]["player"]
    c = state["countries"][p]
    at = all_techs(state)
    known = set(c["techs"])
    av = {t["id"] for t in available(state, known)}
    disc = state.get("discoveries", {})
    from .sim.economy import base_cost
    techs = [{**{k: v for k, v in t.items() if k != "eff"}, "eff": t["eff"], "status": "known" if t["id"] in known else "available" if t["id"] in av else "locked",
              "cost": round(base_cost(t["tier"]), 2), "first": disc.get(t["id"])} for t in at.values()]
    return {"techs": techs, "research": c["research"], "rate": c.get("rp_rate", 0), "focus": c.get("focus"), "auto": c["policies"].get("auto_research", True)}


def set_research(cid: str, tech: str | None, auto: bool | None = None) -> dict:
    with lock(cid):
        state, info = load(cid)
        p = state["meta"]["player"]
        c = state["countries"][p]
        msg = ""
        if tech:
            r = execute_actions(state, p, [{"type": "research", "tech": tech}], rng_for(1, "r"), source="ui")
            msg = r["summary"]
        if auto is not None:
            c["policies"]["auto_research"] = bool(auto)
        persist(cid, state, info)
        return {"ok": True, "message": msg}


def mission_action(cid: str, mid: str, action: str) -> dict:
    with lock(cid):
        state, info = load(cid)
        m = state["missions"].get(mid)
        if not m:
            raise NotFound(mid)
        if action == "track":
            m["tracked"] = not m.get("tracked")
        elif action == "dismiss" and m.get("optional", True) and m["status"] == "active":
            m["status"] = "ignored"
            m["closed"] = state["meta"]["year"]
        persist(cid, state, info)
        return {"ok": True, "mission": m}


# ------------------------------------------------------------------ saves

def list_snapshots(cid: str) -> list[dict]:
    rows = db.conn().execute("SELECT id,year,month,label,kind,created FROM snapshots WHERE campaign_id=? ORDER BY year, id", (cid,)).fetchall()
    return [dict(r) for r in rows]


def save_manual(cid: str, label: str) -> dict:
    with lock(cid):
        state, info = load(cid)
        sid = snapshot(cid, state, label or f"Save {state['meta']['year']}", "manual")
        return {"id": sid}


def snapshot_state(cid: str, sid: int) -> dict:
    r = db.conn().execute("SELECT * FROM snapshots WHERE campaign_id=? AND id=?", (cid, sid)).fetchone()
    if not r:
        raise NotFound(sid)
    return db.unpack(r["state"]) | {"_snap": {"id": r["id"], "last_event": r["last_event"], "label": r["label"]}}


def snapshot_map(cid: str, sid: int) -> dict:
    st = snapshot_state(cid, sid)
    return {"year": st["meta"]["year"], "month": st["meta"]["month"], "provinces": province_view(st),
            "countries": {t: {"name": c["name"], "color": c["color"], "alive": c["alive"]} for t, c in st["countries"].items() if c["alive"]},
            "extra_geo": st.get("extra_geo", {}), "player": st["meta"].get("player"), "era": st["meta"].get("era")}


def restore_snapshot(cid: str, sid: int) -> dict:
    """Load a save in place: the timeline after the save is discarded (events, summaries, later snapshots)."""
    with lock(cid):
        st = snapshot_state(cid, sid)
        snap = st.pop("_snap")
        _, info = load(cid)
        c = db.conn()
        ids = [r[0] for r in c.execute("SELECT id FROM events WHERE campaign_id=? AND id>?", (cid, snap["last_event"]))]
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            rows = c.execute(f"SELECT id,title,body,actors,tags FROM events WHERE id IN ({','.join('?' * len(chunk))})", chunk).fetchall()
            db.fts_delete(c, rows)
        c.execute("DELETE FROM events WHERE campaign_id=? AND id>?", (cid, snap["last_event"]))
        c.execute("DELETE FROM summaries WHERE campaign_id=? AND end_year>=?", (cid, st["meta"]["year"]))
        c.execute("DELETE FROM snapshots WHERE campaign_id=? AND year>? AND kind='auto'", (cid, st["meta"]["year"]))
        c.commit()
        build_index(st)
        st["pending_events"] = []
        persist(cid, st, info)
        return {"ok": True, "year": st["meta"]["year"]}


def export_campaign(cid: str, include_snapshots: bool = True) -> dict:
    state, info = load(cid)
    c = db.conn()
    evs = [dict(r) for r in c.execute("SELECT * FROM events WHERE campaign_id=? ORDER BY id", (cid,)).fetchall()]
    sums = [dict(r) for r in c.execute("SELECT * FROM summaries WHERE campaign_id=? ORDER BY id", (cid,)).fetchall()]
    conv = [dict(r) for r in c.execute("SELECT * FROM conversations WHERE campaign_id=? ORDER BY id", (cid,)).fetchall()]
    docs = [dict(r) for r in c.execute("SELECT * FROM documents WHERE campaign_id=? ORDER BY id", (cid,)).fetchall()]
    snaps = []
    if include_snapshots:
        for r in c.execute("SELECT * FROM snapshots WHERE campaign_id=? ORDER BY id", (cid,)).fetchall():
            snaps.append({k: r[k] for k in ("id", "year", "month", "label", "kind", "created", "last_event")} | {"state": json.loads(__import__("zlib").decompress(r["state"]).decode())})
    clean = {k: v for k, v in state.items() if not k.startswith("_")}
    return {"format": "infinite-history-campaign", "version": 1, "exported": time.time(), "campaign": {"id": cid, "name": info.get("name")},
            "state": clean, "events": evs, "summaries": sums, "conversations": conv, "documents": docs, "snapshots": snaps}


def import_campaign(data: dict, name: str | None = None, upto_event: int | None = None, upto_year: int | None = None, state_override: dict | None = None) -> str:
    if data.get("format") != "infinite-history-campaign":
        raise ValueError("Not an Infinite History campaign file.")
    cid = uuid.uuid4().hex[:12]
    state = state_override or data["state"]
    state["meta"]["campaign_id"] = cid
    c = db.conn()
    idmap = {}
    for e in data.get("events", []):
        if upto_event is not None and e["id"] > upto_event:
            continue
        cur = c.execute("""INSERT INTO events(campaign_id,year,month,kind,title,body,actors,importance,provinces,tags,thread,data,backstory)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (cid, e["year"], e["month"], e["kind"], e["title"], e["body"], e["actors"], e["importance"],
                                                                e["provinces"], e["tags"], e["thread"], e["data"], e["backstory"]))
        idmap[e["id"]] = cur.lastrowid
        db.fts_insert(c, cur.lastrowid, e["title"], e["body"], e["actors"], e["tags"])
    for s in data.get("summaries", []):
        if upto_year is not None and s["end_year"] >= upto_year:
            continue
        c.execute("INSERT INTO summaries(campaign_id,level,start_year,end_year,title,body,created,source) VALUES(?,?,?,?,?,?,?,?)",
                  (cid, s["level"], s["start_year"], s["end_year"], s["title"], s["body"], s["created"], s.get("source")))
    for v in data.get("conversations", []):
        if upto_year is not None and v["year"] > upto_year:
            continue
        c.execute("INSERT INTO conversations(campaign_id,country,role,text,year,month,secret,created,data) VALUES(?,?,?,?,?,?,?,?,?)",
                  (cid, v["country"], v["role"], v["text"], v["year"], v["month"], v["secret"], v["created"], v["data"]))
    for d in data.get("documents", []):
        c.execute("INSERT INTO documents(campaign_id,kind,title,request,body,year,created,source) VALUES(?,?,?,?,?,?,?,?)",
                  (cid, d["kind"], d["title"], d["request"], d["body"], d["year"], d["created"], d["source"]))
    for s in data.get("snapshots", []):
        if upto_year is not None and s["year"] > upto_year:
            continue
        c.execute("INSERT INTO snapshots(campaign_id,year,month,label,kind,created,state,last_event) VALUES(?,?,?,?,?,?,?,?)",
                  (cid, s["year"], s["month"], s["label"], s["kind"], s["created"], db.pack(s["state"]), idmap.get(s["last_event"], 0)))
    c.commit()
    build_index(state)
    state["pending_events"] = []
    persist(cid, state, {"name": name or (data.get("campaign", {}).get("name", "Imported") + " (imported)")})
    return cid


def duplicate(cid: str, name: str | None = None) -> str:
    data = export_campaign(cid)
    return import_campaign(data, name or (data["campaign"]["name"] + " (copy)"))


def branch(cid: str, sid: int, name: str | None = None) -> str:
    st = snapshot_state(cid, sid)
    snap = st.pop("_snap")
    data = export_campaign(cid)
    return import_campaign(data, name or f"{data['campaign']['name']} - branch from {st['meta']['year']}", upto_event=snap["last_event"], upto_year=st["meta"]["year"], state_override=st)


def delete(cid: str) -> None:
    with lock(cid):
        db.delete_campaign(cid)
        _cache.pop(cid, None)


# ------------------------------------------------------------------ chronicle & narrative

def write_history(cid: str, request: str) -> dict:
    state, _ = load(cid)
    doc = narrative.write_history(state, cid, request)
    c = db.conn()
    body = doc["body"] or "\n\n".join(f"## {ch['title']}\n\n{ch['body']}" for ch in doc["chapters"])
    cur = c.execute("INSERT INTO documents(campaign_id,kind,title,request,body,year,created,source) VALUES(?,?,?,?,?,?,?,?)",
                    (cid, "history", doc["title"], request, body, state["meta"]["year"], time.time(), doc["source"]))
    c.commit()
    doc["id"] = cur.lastrowid
    return doc


def documents(cid: str) -> list[dict]:
    return [dict(r) for r in db.conn().execute("SELECT id,kind,title,request,body,year,source FROM documents WHERE campaign_id=? ORDER BY id DESC", (cid,)).fetchall()]


def newspaper(cid: str, year: int | None = None, month: int | None = None, country: str | None = None) -> dict:
    state, _ = load(cid)
    return narrative.newspaper(state, cid, year, month, country)


def briefing(cid: str) -> dict:
    state, _ = load(cid)
    return narrative.briefing(state, cid)


def advisor_report(cid: str) -> dict:
    state, _ = load(cid)
    return advisor.analyse(state)


def advisor_ask(cid: str, q: str) -> dict:
    state, _ = load(cid)
    return advisor.ask(state, cid, q)


def chronicle(cid: str, **kw) -> list[dict]:
    return store.query_events(cid, **kw)


def summaries(cid: str) -> list[dict]:
    return store.list_summaries(cid)


def rankings(cid: str) -> dict:
    state, _ = load(cid)
    rows = []
    tot = world_totals(state)
    for t in alive(state):
        c = state["countries"][t]
        rows.append({"tag": t, "name": c["name"], "color": c["color"], "gdp": round(c["gdp"], 2), "gdp_share": round(c["gdp"] / tot["gdp"], 4), "pop": round(c["pop"], 2),
                     "power": round(total_power(c), 2), "techs": len(c["techs"]), "stability": round(c["stability"]), "provinces": len([1 for x in state["provinces"].values() if x["owner"] == t]),
                     "gov": c["gov"], "ideology": get_ideology(state, c["ideology"])["name"], "dig": round(c["pops"].get("dig", 0), 2), "overlord": c.get("overlord")})
    rows.sort(key=lambda r: -r["power"])
    return {"rows": rows, "world": tot}
