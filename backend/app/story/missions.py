"""Adaptive mission generation. Missions are derived from the current phase of the player's state, active
storylines, claims, rivals, technology, anniversaries and the campaign's history - never from a fixed tree.
Every objective is a machine-checkable condition evaluated by the deterministic simulation."""
from __future__ import annotations

from ..util import clamp, fmt_money
from ..world.geo import get_geo
from ..world.techtree import all_techs, available
from ..sim.economy import base_cost, years_for
from ..sim.core import alive, allies, at_war, bloc_of, emit, idx, total_power, treaty_between, world_totals
from ..sim.relations import opinion
from .threads import active_threads

COND_TYPES = {"gdp", "gdp_pc", "stability", "legitimacy", "control", "not_control", "prov_count", "prov_share", "gdp_share", "tech",
              "unrest_max", "integration", "no_war", "at_peace_with", "alliance_count", "treaty", "opinion", "country_dead",
              "power_ratio", "colony", "offworld_pop", "policy", "gov_family", "org_member", "research_share", "dig_share",
              "thread_resolved", "survive_until", "treasury", "law", "army", "project_done", "subjects", "war_ended", "terraform",
              "tech_count", "dev"}
SINGLETON_BASES = {"growth", "order", "conspiracy", "supremacy", "sphere", "regional_bloc", "integrate", "suppress", "old_nations",
                   "global_infra", "space_fleet", "mars", "recover", "reorg", "conquer"}
EFFECT_KEYS = {"stability", "legitimacy", "treasury_gdp", "research_boost", "prod", "integration", "war_support", "opinion_world", "unrest"}


def _p(state, tag):
    return [p for p in idx(state)["owned"].get(tag, [])]


def evaluate(state: dict, tag: str, cond: dict) -> tuple[bool, float]:
    c = state["countries"].get(tag)
    if not c or not c["alive"]:
        return False, 0.0
    t = cond.get("t")
    provs = state["provinces"]
    bloc = bloc_of(state, tag)
    try:
        if t == "gdp":
            return c["gdp"] >= cond["min"], clamp(c["gdp"] / cond["min"], 0, 1)
        if t == "gdp_pc":
            return c.get("gpc", 0) >= cond["min"], clamp(c.get("gpc", 0) / cond["min"], 0, 1)
        if t == "stability":
            return c["stability"] >= cond["min"], clamp(c["stability"] / cond["min"], 0, 1)
        if t == "legitimacy":
            return c["legitimacy"] >= cond["min"], clamp(c["legitimacy"] / cond["min"], 0, 1)
        if t == "control":
            ps = cond["provinces"]
            n = sum(1 for p in ps if provs.get(p, {}).get("owner") in bloc)
            need = cond.get("min_share", 1.0)
            return n / max(1, len(ps)) >= need, n / max(1, len(ps)) / need
        if t == "not_control":
            ps = cond["provinces"]
            n = sum(1 for p in ps if provs.get(p, {}).get("owner") != tag)
            return n == len(ps), n / max(1, len(ps))
        if t == "prov_count":
            n = len(_p(state, tag))
            return n >= cond["min"], clamp(n / cond["min"], 0, 1)
        if t in ("prov_share", "gdp_share"):
            tot = world_totals(state)
            if t == "gdp_share":
                v = sum(state["countries"][x]["gdp"] for x in sorted(bloc)) / tot["gdp"]
            else:
                earth = [p for p in provs.values() if p["body"] == "earth" and p["owner"]]
                v = sum(1 for p in earth if p["owner"] in bloc) / max(1, len(earth))
            return v >= cond["min"], clamp(v / cond["min"], 0, 1)
        if t == "tech":
            return cond["tech"] in c["techs"], (1.0 if cond["tech"] in c["techs"] else clamp(c["research"].get("progress", 0) / max(1e-6, c["research"].get("cost", 1)), 0, 0.95) if c["research"].get("target") == cond["tech"] else 0.0)
        if t == "tech_count":
            return len(c["techs"]) >= cond["min"], clamp(len(c["techs"]) / cond["min"], 0, 1)
        if t == "unrest_max":
            ps = [p for p in cond["provinces"] if provs.get(p, {}).get("owner") == tag] or []
            if not ps:
                return True, 1.0
            avg = sum(provs[p]["unrest"] for p in ps) / len(ps)
            return avg <= cond["max"], clamp(1 - (avg - cond["max"]) / 100, 0, 1)
        if t == "integration":
            ps = [p for p in cond["provinces"] if provs.get(p, {}).get("owner") == tag]
            if not ps:
                return False, 0.0
            avg = sum(provs[p]["integ"] for p in ps) / len(ps)
            return avg >= cond["min"], clamp(avg / cond["min"], 0, 1)
        if t == "no_war":
            return not at_war(state, tag), 0.0 if at_war(state, tag) else 1.0
        if t == "at_peace_with":
            return not at_war(state, tag, cond["target"]), 0.0
        if t == "war_ended":
            return not any(w["id"] == cond["war"] for w in state["wars"]), 0.0
        if t == "alliance_count":
            n = len(allies(state, tag))
            return n >= cond["min"], clamp(n / cond["min"], 0, 1)
        if t == "treaty":
            return bool(treaty_between(state, tag, cond["target"], tuple(cond.get("kinds", ["alliance", "defensive_pact"])))), 0.0
        if t == "opinion":
            v = opinion(state, cond["target"], tag)
            return v >= cond["min"], clamp((v + 100) / (cond["min"] + 100), 0, 1)
        if t == "country_dead":
            return not state["countries"].get(cond["target"], {}).get("alive"), 0.0
        if t == "power_ratio":
            o = state["countries"].get(cond["target"])
            if not o or not o["alive"]:
                return True, 1.0
            r = total_power(c) / max(0.01, total_power(o))
            return r >= cond["min"], clamp(r / cond["min"], 0, 1)
        if t == "colony":
            pop = sum(p["pop"] for p in provs.values() if p["owner"] in bloc and p["body"] == cond["body"])
            ok = pop >= cond.get("min_pop", 0.0001) and any(p["owner"] in bloc and p["body"] == cond["body"] for p in provs.values())
            return ok, clamp(pop / max(1e-6, cond.get("min_pop", 0.0001)), 0, 1) if pop else 0.0
        if t == "offworld_pop":
            pop = sum(p["pop"] for p in provs.values() if p["owner"] in bloc and p["body"] != "earth")
            return pop >= cond["min"], clamp(pop / cond["min"], 0, 1)
        if t == "policy":
            vals = cond["value"] if isinstance(cond["value"], list) else [cond["value"]]
            return c["policies"].get(cond["policy"]) in vals, 0.0
        if t == "gov_family":
            from ..world.ideologies import get_ideology
            fams = cond["value"] if isinstance(cond["value"], list) else [cond["value"]]
            return get_ideology(state, c["ideology"])["family"] in fams or any(f.lower() in c["gov"].lower() for f in cond.get("gov_words", [])), 0.0
        if t == "org_member":
            n = sum(1 for o in state["orgs"].values() if tag in o["members"] and o["kind"] in cond.get("kinds", [o["kind"]]) and len(o["members"]) >= cond.get("min_members", 2))
            return n >= 1, 0.0
        if t == "research_share":
            return c["budget"].get("research", 0) >= cond["min"] - 1e-9, clamp(c["budget"].get("research", 0) / cond["min"], 0, 1)
        if t == "dig_share":
            v = c["flags"].get("dig_share", 0)
            return v >= cond["min"], clamp(v / cond["min"], 0, 1)
        if t == "thread_resolved":
            th = state["threads"].get(cond["thread"])
            return (th is None or th["status"] != "active"), 0.0
        if t == "survive_until":
            return state["meta"]["year"] >= cond["year"], 0.0
        if t == "treasury":
            return c["treasury"] >= cond["min"], clamp(c["treasury"] / cond["min"], 0, 1)
        if t == "law":
            s = cond["contains"].lower()
            return any(s in l["name"].lower() for l in c["laws"]), 0.0
        if t == "army":
            return c["army"] >= cond["min"], clamp(c["army"] / cond["min"], 0, 1)
        if t == "project_done":
            n = c["flags"].get("projects_done", {}).get(cond["kind"], 0)
            return n >= cond.get("min", 1), 0.0
        if t == "subjects":
            n = sum(1 for x in state["countries"].values() if x["alive"] and x.get("overlord") == tag)
            return n >= cond["min"], clamp(n / cond["min"], 0, 1)
        if t == "terraform":
            v = state["bodies"].get(cond["body"], {}).get("terraform", 0)
            return v >= cond["min"], clamp(v / cond["min"], 0, 1)
        if t == "dev":
            ps = _p(state, tag)
            v = sum(provs[p]["dev"] for p in ps) / max(1, len(ps))
            return v >= cond["min"], clamp(v / cond["min"], 0, 1)
    except (KeyError, TypeError, ZeroDivisionError):
        return False, 0.0
    return False, 0.0


def validate_mission(state: dict, m: dict) -> dict | None:
    """Sanitise a mission proposed by an AI model or generator; drop anything not machine-checkable."""
    objs = []
    for o in m.get("objectives", [])[:5]:
        cond = o.get("cond") or {}
        if cond.get("t") not in COND_TYPES:
            continue
        for k in ("provinces",):
            if k in cond:
                cond[k] = [p for p in cond[k] if p in state["provinces"]][:40]
                if not cond[k]:
                    cond = None
                    break
        if not cond:
            continue
        for k in ("target",):
            if k in cond and cond[k] not in state["countries"]:
                cond = None
                break
        if cond and cond.get("t") == "tech" and cond.get("tech") not in all_techs(state):
            continue
        if cond:
            objs.append({"text": str(o.get("text", ""))[:200] or cond["t"], "cond": cond})
    if not objs:
        return None
    def eff(d):
        return {k: clamp(float(v), -0.5 if k in ("prod", "treasury_gdp", "research_boost") else -40, 0.5 if k in ("prod", "treasury_gdp", "research_boost") else 40)
                for k, v in (d or {}).items() if k in EFFECT_KEYS and isinstance(v, (int, float))}
    year = state["meta"]["year"]
    dl = m.get("deadline")
    try:
        dl = int(dl) if dl is not None else None
        if dl is not None:
            dl = int(clamp(dl, year + 1, year + 200))
    except (TypeError, ValueError):
        dl = None
    return {"title": str(m.get("title", "Untitled mission"))[:90], "category": m.get("category", "political") if m.get("category") in
            ("economic", "military", "diplomatic", "administrative", "scientific", "cultural", "crisis", "space", "political") else "political",
            "desc": str(m.get("desc", ""))[:900], "importance": str(m.get("importance", ""))[:300], "objectives": objs,
            "mode": "any" if m.get("mode") == "any" else "all", "rewards": eff(m.get("rewards")), "reward_text": str(m.get("reward_text", ""))[:240],
            "failure": eff(m.get("failure")), "failure_text": str(m.get("failure_text", ""))[:240], "deadline": dl,
            "optional": bool(m.get("optional", True)), "hidden": bool(m.get("hidden", False)), "actors": [a for a in m.get("actors", []) if a in state["countries"]][:6],
            "key": str(m.get("key") or m.get("title"))[:120], "phases": m.get("phases") or [], "reveal": m.get("reveal")}


def add_mission(state: dict, m: dict, source: str = "engine", origin: str | None = None) -> dict | None:
    v = validate_mission(state, m)
    if not v:
        return None
    base = v["key"].split(":")[0]
    for x in state["missions"].values():
        if x["key"] == v["key"] and (x["status"] == "active" or state["meta"]["year"] - x["created"] < 25):
            return None
        if base in SINGLETON_BASES and x["status"] == "active" and x["key"].split(":")[0] == base:
            return None
    if base == "pacify" and sum(1 for x in state["missions"].values() if x["status"] == "active" and x["key"].startswith("pacify:")) >= 3:
        return None
    from ..world.scenario import next_id
    v.update({"id": next_id(state, "m"), "status": "active", "created": state["meta"]["year"], "source": source, "origin": origin,
              "progress": 0.0, "tracked": False})
    state["missions"][v["id"]] = v
    return v


def _names(state, pids, n=3):
    from ..sim.war import _pname
    names = [_pname(state, p) for p in pids[:n]]
    return ", ".join(names) + (f" and {len(pids) - n} more" if len(pids) > n else "")


def candidates(state: dict, tag: str) -> list[dict]:
    """Generate candidate missions from the actual state of the world."""
    c = state["countries"][tag]
    meta = state["meta"]
    year = meta["year"]
    phase = meta.get("phase") or "regional_power"
    provs = state["provinces"]
    out: list[dict] = []
    tot = world_totals(state)
    gdp_share = sum(state["countries"][x]["gdp"] for x in sorted(bloc_of(state, tag))) / tot["gdp"]
    mine = _p(state, tag)
    noncore = [p for p in mine if tag not in provs[p]["cores"]]
    # --- universal: economy & order
    out.append({"key": f"growth:{year // 10}", "title": "Engine of Prosperity" if year < 2100 else "The Abundance Mandate", "category": "economic",
                "desc": f"The economy of {c['name']} stands at {fmt_money(c['gdp'])}. Sustained growth funds everything else - armies, science and the loyalty of citizens.",
                "importance": "Economic weight underpins every other ambition.", "objectives": [{"text": f"Reach a GDP of {fmt_money(c['gdp'] * 1.3)}", "cond": {"t": "gdp", "min": round(c["gdp"] * 1.3, 2)}}],
                "rewards": {"stability": 4, "legitimacy": 5}, "reward_text": "+4 stability, +5 legitimacy", "deadline": year + 10, "optional": True, "phases": []})
    if c["stability"] < 42:
        out.append({"key": f"order:{year // 5}", "title": "Restore Public Order", "category": "crisis",
                    "desc": f"Stability in {c['name']} has fallen to {c['stability']:.0f}%. Strikes, riots and plots multiply; a regime that cannot keep order will not survive.",
                    "importance": "Below 18% stability, revolution or civil war becomes likely.", "objectives": [{"text": "Raise stability to 55%", "cond": {"t": "stability", "min": 55}}],
                    "rewards": {"legitimacy": 10}, "reward_text": "+10 legitimacy", "failure": {"legitimacy": -10}, "failure_text": "-10 legitimacy", "deadline": year + 4, "optional": False, "phases": []})
    # --- claims on neighbours
    claims_by_owner: dict[str, list[str]] = {}
    for pid in c["claims"]:
        o = provs.get(pid, {}).get("owner")
        if o and o != tag and o not in bloc_of(state, tag):
            claims_by_owner.setdefault(o, []).append(pid)
    for o, ps in sorted(claims_by_owner.items(), key=lambda kv: -len(kv[1]))[:2]:
        oc = state["countries"][o]
        oldest = min(c["claims"][p] for p in ps)
        whole = len(ps) >= len(idx(state)["owned"].get(o, []))
        title = f"Union with {oc['name']}" if whole else f"Recover {_names(state, ps, 2)}"
        out.append({"key": f"claims:{o}:{len(ps)}", "title": title, "category": "military",
                    "desc": f"Since {oldest}, {c['name']} has claimed {_names(state, ps)}, now held by {oc['name']}. The grievance is part of national memory; diplomacy, pressure or war could settle it.",
                    "importance": f"Recovering lost lands strengthens legitimacy but will be remembered by {oc['name']}.", "actors": [o],
                    "objectives": [{"text": f"Control {_names(state, ps, 4)}", "cond": {"t": "control", "provinces": ps}}],
                    "rewards": {"legitimacy": 10, "stability": 5}, "reward_text": "+10 legitimacy, +5 stability", "deadline": year + 15, "optional": True, "phases": []})
    # --- storylines become missions
    for th in active_threads(state, tag):
        k = th["kind"]
        if k == "resistance":
            ps = [p for p in th["provinces"] if provs.get(p, {}).get("owner") == tag]
            if ps:
                out.append({"key": f"pacify:{th['id']}", "title": th["title"].replace("Resistance in", "Settle the Question of"), "category": "administrative", "mode": "any",
                            "desc": f"{th['summary']} Since {th['started']} the resistance has grown to an average unrest of {th['tension']:.0f}%. It can be pacified, accommodated with autonomy, or released.",
                            "importance": "Unrest above 68% leads to open rebellion and secession.",
                            "objectives": [{"text": f"Reduce average unrest in {_names(state, ps, 2)} below 25%", "cond": {"t": "unrest_max", "provinces": ps, "max": 25}},
                                           {"text": "Or release the region", "cond": {"t": "not_control", "provinces": ps}}],
                            "rewards": {"stability": 6}, "reward_text": "+6 stability", "deadline": year + 8, "optional": True, "phases": [], "origin": th["id"]})
        elif k == "war":
            w = next((w for w in state["wars"] if w.get("thread") == th["id"]), None)
            if w:
                out.append({"key": f"war:{w['id']}", "title": f"Victory in the {w['name']}", "category": "military",
                            "desc": f"The {w['name']} began in {w['start']}. Current war score: {w['score'] if tag in w['att'] else -w['score']:+.0f}. End it on favourable terms without losing territory.",
                            "importance": "Defeat means lost provinces and a lasting grievance.", "actors": [x for x in w["att"] + w["def"] if x != tag][:4],
                            "objectives": [{"text": "End the war", "cond": {"t": "war_ended", "war": w["id"]}}, {"text": "Lose no territory", "cond": {"t": "control", "provinces": mine[:40]}}],
                            "rewards": {"legitimacy": 12, "war_support": 10}, "reward_text": "+12 legitimacy", "failure": {"stability": -8}, "failure_text": "-8 stability", "deadline": None, "optional": False, "phases": [], "origin": th["id"]})
        elif k == "succession":
            out.append({"key": f"succ:{th['id']}", "title": "Secure the Succession", "category": "crisis",
                        "desc": th["summary"] + " Until it is settled, the court and the army are divided.", "importance": "A long crisis can turn into civil war.",
                        "objectives": [{"text": "Resolve the succession crisis", "cond": {"t": "thread_resolved", "thread": th["id"]}}, {"text": "Stability of at least 50%", "cond": {"t": "stability", "min": 50}}],
                        "rewards": {"legitimacy": 15}, "reward_text": "+15 legitimacy", "failure": {"stability": -10}, "failure_text": "-10 stability", "deadline": year + 3, "optional": False, "phases": []})
        elif k == "colonial_tension":
            body = th["data"].get("body")
            bname = state["bodies"].get(body, {}).get("name", body)
            out.append({"key": f"colq:{th['id']}", "title": f"The {bname.split(' (')[0]} Question", "category": "space", "mode": "any",
                        "desc": f"{th['summary']} Tension stands at {th['tension']:.0f}. Will {c['name']} bind its settlers through representation, accept their autonomy, or let them go?",
                        "importance": "Ignored, colonial grievances end in a declaration of independence.",
                        "objectives": [{"text": "Adopt colonial home rule or representation", "cond": {"t": "policy", "policy": "colonial", "value": ["autonomy", "representation"]}},
                                       {"text": "Or resolve the tension", "cond": {"t": "thread_resolved", "thread": th["id"]}}],
                        "rewards": {"stability": 5}, "reward_text": "+5 stability", "deadline": year + 10, "optional": True, "phases": []})
        elif k in ("digital_rights", "ai_rights"):
            pol = "digital_rights" if k == "digital_rights" else "ai_rights"
            out.append({"key": f"rights:{th['id']}", "title": "Rights of the Uploaded" if k == "digital_rights" else "The Personhood Question", "category": "political", "mode": "any",
                        "desc": th["summary"] + " The law still treats them as property or data.", "importance": "Denied rights fuel strikes in the networks and instability.",
                        "objectives": [{"text": "Grant at least limited legal rights", "cond": {"t": "policy", "policy": pol, "value": ["limited", "equal"]}}],
                        "rewards": {"stability": 6, "legitimacy": 5}, "reward_text": "+6 stability", "deadline": year + 12, "optional": True, "phases": []})
        elif k == "rivalry":
            o = th["actors"][1]
            oc = state["countries"].get(o)
            if oc and oc["alive"]:
                out.append({"key": f"rival:{o}:{year // 15}", "title": f"Contain {oc['name']}", "category": "diplomatic",
                            "desc": f"{oc['name']} under {oc['leader']['name']} has become {c['name']}'s chief rival. Build a coalition and an edge in power before the rivalry is settled by force.",
                            "importance": "A rival superpower can contest every other objective.", "actors": [o],
                            "objectives": [{"text": "Have at least 2 allies", "cond": {"t": "alliance_count", "min": 2}}, {"text": f"Be 1.3x as powerful as {oc['name']}", "cond": {"t": "power_ratio", "target": o, "min": 1.3}}],
                            "rewards": {"stability": 5, "legitimacy": 5}, "reward_text": "+5 stability, +5 legitimacy", "deadline": year + 15, "optional": True, "phases": []})
        elif k == "economic_crisis":
            out.append({"key": f"recover:{th['id']}", "title": "Economic Recovery", "category": "economic", "desc": th["summary"] + " Restoring output is the first task of government.",
                        "importance": "Recessions drain stability.", "objectives": [{"text": f"Restore GDP to {fmt_money(c.get('prev_gdp', c['gdp']) * 1.02)}", "cond": {"t": "gdp", "min": round(c.get("prev_gdp", c["gdp"]) * 1.02, 2)}}],
                        "rewards": {"stability": 5}, "reward_text": "+5 stability", "deadline": year + 4, "optional": True, "phases": []})
        elif k == "overstretch":
            out.append({"key": f"reorg:{th['id']}", "title": "Imperial Reorganisation", "category": "administrative", "mode": "any",
                        "desc": th["summary"] + " Either the conquered lands are bound into the state through integration and reform, or the state must devolve power.",
                        "importance": "Overstretched empires fall into revolt and collapse.",
                        "objectives": [{"text": "Average integration of conquered provinces at least 60%", "cond": {"t": "integration", "provinces": noncore[:40] or mine[:1], "min": 60}},
                                       {"text": "Or adopt a federal/autonomy integration policy", "cond": {"t": "policy", "policy": "integration", "value": ["autonomy", "federal"]}}],
                        "rewards": {"stability": 8, "integration": 5}, "reward_text": "+8 stability", "deadline": year + 12, "optional": True, "phases": []})
    # --- technology frontier
    av = sorted(available(state, set(c["techs"])), key=lambda t: t["tier"])
    big = [t for t in av if t["eff"].get("unlock") or t["tier"] >= 17][:2] or av[:1]
    for t in big:
        rp = max(1e-6, c.get("rp_rate", 0.1))
        cost = base_cost(t["tier"])
        yrs = int(clamp(years_for(cost, rp) * 1.4, 3, 60))
        out.append({"key": f"tech:{t['id']}", "title": f"The {t['name']} Programme", "category": "scientific",
                    "desc": f"{t['desc']} Our scientists believe it is within reach in roughly {yrs} years at current funding ({c['budget'].get('research', 0) * 100:.1f}% of GDP).",
                    "importance": "Unlocks: " + ", ".join(t["eff"].get("unlock", [])) if t["eff"].get("unlock") else "A major step on the technological frontier.",
                    "objectives": [{"text": f"Research {t['name']}", "cond": {"t": "tech", "tech": t["id"]}}],
                    "rewards": {"research_boost": 0.3, "legitimacy": 4}, "reward_text": "Research boost, +4 legitimacy", "deadline": year + yrs, "optional": True, "phases": []})
    # --- anniversaries of the nation's own history
    for ms in state["milestones"]:
        if tag in ms.get("actors", []) or any(h.get("tag") in ms.get("actors", []) for h in c.get("heritage", [])):
            for age in (50, 100, 250, 500, 1000):
                if 0 < ms["y"] + age - year <= 3:
                    out.append({"key": f"jubilee:{ms['title']}:{age}", "title": f"Jubilee: {age} Years since {ms['title']}", "category": "cultural",
                                "desc": f"In {ms['y'] + age} the nation will mark {age} years since {ms['title']} ({ms['y']}). A fitting commemoration would bind citizens to their shared past.",
                                "importance": "Shared memory strengthens legitimacy.", "objectives": [{"text": "Hold a national commemoration (order: 'hold a jubilee celebration')", "cond": {"t": "project_done", "kind": "jubilee"}}],
                                "rewards": {"stability": 6, "legitimacy": 8}, "reward_text": "+6 stability, +8 legitimacy", "deadline": ms["y"] + age + 1, "optional": True, "phases": []})
    # --- phase-specific missions
    out += _phase_missions(state, tag, phase, gdp_share, mine, noncore)
    return out


def _phase_missions(state, tag, phase, gdp_share, mine, noncore) -> list[dict]:
    c = state["countries"][tag]
    year = state["meta"]["year"]
    provs = state["provinces"]
    out = []
    P = lambda *ph: list(ph)
    if phase in ("minor_state", "regional_power"):
        out.append({"key": "protector", "title": "Seek a Protector", "category": "diplomatic", "phases": P("minor_state", "regional_power"),
                    "desc": f"{c['name']} cannot stand alone against the great powers. A defensive pact with a strong partner would deter aggression.",
                    "importance": "Small states without allies are tempting targets.", "objectives": [{"text": "Have at least one ally", "cond": {"t": "alliance_count", "min": 1}}],
                    "rewards": {"stability": 4}, "reward_text": "+4 stability", "deadline": year + 8})
        out.append({"key": f"regional_bloc:{year // 20}", "title": "Regional Leadership", "category": "diplomatic", "phases": P("regional_power", "minor_state"),
                    "desc": "Found or join a regional organisation of at least three states to amplify the nation's voice ('create an alliance called ... with A, B and C').",
                    "importance": "Collective weight is the strength of the small.", "objectives": [{"text": "Belong to an organisation with 3+ members", "cond": {"t": "org_member", "min_members": 3}}],
                    "rewards": {"legitimacy": 6}, "reward_text": "+6 legitimacy", "deadline": year + 12})
    if phase == "great_power":
        out.append({"key": f"supremacy:{year // 20}", "title": "Industrial Supremacy", "category": "economic", "phases": P("great_power"),
                    "desc": f"{c['name']} produces {gdp_share * 100:.1f}% of world output. Becoming the workshop of the world would make it unchallengeable.",
                    "importance": "Economic dominance precedes political dominance.", "objectives": [{"text": f"Reach {min(60, gdp_share * 100 + 6):.0f}% of world GDP", "cond": {"t": "gdp_share", "min": round(min(0.6, gdp_share + 0.06), 3)}}],
                    "rewards": {"prod": 0.03, "legitimacy": 6}, "reward_text": "+3% productivity", "deadline": year + 20})
        out.append({"key": f"sphere:{year // 20}", "title": "A Sphere of Influence", "category": "diplomatic", "phases": P("great_power", "continental_empire"),
                    "desc": "Great powers lead blocs. Bind lesser states to you as allies or subjects.", "importance": "Allies and clients extend reach without the cost of conquest.",
                    "objectives": [{"text": "Have 3 allies or subjects", "cond": {"t": "alliance_count", "min": 3}}], "rewards": {"legitimacy": 6}, "reward_text": "+6 legitimacy", "deadline": year + 15})
    if phase == "continental_empire":
        if noncore:
            out.append({"key": f"integrate:{year // 15}", "title": "Integrate the Occupied Territories", "category": "administrative", "phases": P("continental_empire", "planetary_hegemon"),
                        "desc": f"{c['name']} now governs {len(noncore)} provinces whose people do not consider themselves its citizens: {_names(state, noncore)}. Conquest must become administration.",
                        "importance": "Unintegrated provinces are a permanent source of unrest and revolt.", "objectives": [{"text": "Average integration of non-core provinces 60%+", "cond": {"t": "integration", "provinces": noncore[:40], "min": 60}}],
                        "rewards": {"stability": 8, "prod": 0.03}, "reward_text": "+8 stability, +3% productivity", "deadline": year + 15})
            out.append({"key": f"suppress:{year // 10}", "title": "Break the Resistance", "category": "military", "phases": P("continental_empire"), "mode": "any",
                        "desc": "Partisans, saboteurs and exiled governments contest imperial rule. Garrison policy, reform or concessions can reduce resistance.",
                        "importance": "Resistance drains manpower and output.", "objectives": [{"text": "Average unrest in non-core provinces below 30%", "cond": {"t": "unrest_max", "provinces": noncore[:40], "max": 30}}],
                        "rewards": {"stability": 5}, "reward_text": "+5 stability", "deadline": year + 8})
        out.append({"key": "imperial_admin", "title": "An Imperial Administration", "category": "administrative", "phases": P("continental_empire", "planetary_hegemon"), "mode": "any",
                    "desc": "The institutions of a nation-state cannot govern a continent. Reorganise the state as an imperial federation or create a new administrative law (e.g. 'Establish an Imperial Administrative Code').",
                    "importance": "Institutional reform determines whether empires last decades or centuries.",
                    "objectives": [{"text": "Adopt an imperial/federal form of government", "cond": {"t": "gov_family", "value": ["imperial", "post-national"], "gov_words": ["Imperial", "Federation", "Federal"]}},
                                   {"text": "Or enact an administrative law", "cond": {"t": "law", "contains": "admin"}}],
                    "rewards": {"stability": 6, "integration": 10}, "reward_text": "+6 stability, +10 integration", "deadline": year + 10})
        others = sorted((o for o in alive(state) if o != tag and not state["countries"][o].get("overlord")), key=lambda o: -total_power(state["countries"][o]))
        if others:
            r = state["countries"][others[0]]
            out.append({"key": f"no_rival:{others[0]}", "title": f"Prevent the Rise of {r['name']}", "category": "military", "phases": P("continental_empire", "great_power"), "actors": [others[0]],
                        "desc": f"{r['name']} is the only power left that could challenge {c['name']}. Keep it at no more than half our strength - by alliance, containment or war.",
                        "importance": "A peer competitor could reverse the conquests.", "objectives": [{"text": f"Be at least twice as powerful as {r['name']}", "cond": {"t": "power_ratio", "target": others[0], "min": 2.0}}],
                        "rewards": {"legitimacy": 8}, "reward_text": "+8 legitimacy", "deadline": year + 20})
    if phase in ("planetary_hegemon", "interplanetary_hegemon"):
        out.append({"key": "planetary_gov", "title": "Establish Planetary Administration", "category": "administrative", "phases": P("planetary_hegemon", "interplanetary_hegemon"), "mode": "any",
                    "desc": f"{c['name']} now rules most of humanity. The old national institutions are inadequate for a planet; a planetary government would turn conquest into a lasting order ('Establish a planetary government').",
                    "importance": "Without new institutions the world-state will fragment along old national lines.",
                    "objectives": [{"text": "Adopt a planetary/post-national government", "cond": {"t": "gov_family", "value": ["post-national"], "gov_words": ["Planetary", "World", "Global"]}},
                                   {"text": "Or enact a planetary constitution", "cond": {"t": "law", "contains": "planetary"}}],
                    "rewards": {"stability": 10, "legitimacy": 10}, "reward_text": "+10 stability, +10 legitimacy", "deadline": year + 15})
        out.append({"key": f"old_nations:{year // 25}", "title": "Reconcile the Former Nations", "category": "political", "phases": P("planetary_hegemon", "interplanetary_hegemon"),
                    "desc": "Beneath the planetary order, the memory of the old nations persists - their languages, grievances and lost sovereignty. Their loyalty must be won.",
                    "importance": "National revivals are the main threat to a world-state.", "objectives": [{"text": "Average unrest of all provinces below 20%", "cond": {"t": "unrest_max", "provinces": mine[:60], "max": 20}}],
                    "rewards": {"stability": 8}, "reward_text": "+8 stability", "deadline": year + 25})
        out.append({"key": f"global_infra:{year // 30}", "title": "Global Infrastructure Programme", "category": "economic", "phases": P("planetary_hegemon", "interplanetary_hegemon"),
                    "desc": "Connect every region of the planet with modern infrastructure, lifting the poorest former colonies to the level of the core.",
                    "importance": "Development binds the periphery to the centre.", "objectives": [{"text": "Average development 1.25+", "cond": {"t": "dev", "min": 1.25}}],
                    "rewards": {"prod": 0.05, "stability": 4}, "reward_text": "+5% productivity", "deadline": year + 30})
        out.append({"key": "unified_science", "title": "A Unified Science Academy", "category": "scientific", "phases": P("planetary_hegemon", "interplanetary_hegemon", "post_biological"),
                    "desc": "With the whole planet's resources, research can be organised on an unprecedented scale. Commit at least 5% of GDP to science.",
                    "importance": "The next frontier is technological, not territorial.", "objectives": [{"text": "Research spending at least 5% of GDP", "cond": {"t": "research_share", "min": 0.05}}],
                    "rewards": {"research_boost": 0.5}, "reward_text": "Major research boost", "deadline": year + 5})
        out.append({"key": "eternal_succession", "title": "Law of Succession for an Undying State", "category": "political", "phases": P("planetary_hegemon", "interplanetary_hegemon", "continental_empire"),
                    "desc": "Empires most often fall at the death of their rulers. Codify succession so that the state outlives every leader ('enact a succession law').",
                    "importance": "Succession crises are the commonest cause of imperial collapse.", "objectives": [{"text": "Enact a succession law", "cond": {"t": "law", "contains": "succession"}}],
                    "rewards": {"legitimacy": 10, "stability": 4}, "reward_text": "+10 legitimacy", "deadline": year + 20})
    if phase in ("planetary_hegemon", "great_power", "continental_empire", "interplanetary", "interplanetary_hegemon") and "lunar_base" in c["techs"]:
        if not any(p["owner"] == tag and p["body"] == "luna" for p in provs.values()):
            out.append({"key": "luna", "title": "A Foothold on the Moon", "category": "space", "phases": [],
                        "desc": "The technology for permanent lunar bases exists. Whoever holds the lunar poles holds the gateway to the solar system ('colonise Shackleton Rim').",
                        "importance": "Lunar ice and low gravity make the Moon the staging post for everything beyond.", "objectives": [{"text": "Establish a settlement on Luna", "cond": {"t": "colony", "body": "luna"}}],
                        "rewards": {"legitimacy": 6}, "reward_text": "+6 legitimacy", "deadline": year + 15})
    if "mars_colonization" in c["techs"]:
        mars_pop = sum(p["pop"] for p in provs.values() if p["owner"] == tag and p["body"] == "mars")
        if mars_pop < 1:
            out.append({"key": f"mars:{int(mars_pop * 10)}", "title": "The Red Frontier" if mars_pop == 0 else "A Martian Metropolis", "category": "space", "phases": [],
                        "desc": "Mars is open to settlement." + (f" Our Martian settlements number {mars_pop * 1e6:,.0f} people." if mars_pop else " Plant the flag and the first permanent settlement."),
                        "importance": "Mars is the only world in reach where a second human civilisation could grow.",
                        "objectives": [{"text": "Settle Mars" if not mars_pop else "Reach 1 million people on Mars", "cond": {"t": "colony", "body": "mars", "min_pop": 0.0001 if not mars_pop else 1.0}}],
                        "rewards": {"legitimacy": 8, "stability": 3}, "reward_text": "+8 legitimacy", "deadline": year + (15 if not mars_pop else 60)})
    if phase in ("interplanetary", "interplanetary_hegemon"):
        out.append({"key": f"space_fleet:{year // 30}", "title": "Command of Space", "category": "military", "phases": P("interplanetary", "interplanetary_hegemon"),
                    "desc": "Colonies are only as secure as the fleets that can reach them.", "importance": "Without space power, distant colonies can be lost to rivals or rebels.",
                    "objectives": [{"text": "Research Space Warfare", "cond": {"t": "tech", "tech": "space_warfare"}}], "rewards": {"stability": 3}, "reward_text": "+3 stability", "deadline": year + 25})
        if "terraforming" in c["techs"]:
            out.append({"key": "terraform_mars", "title": "Make Mars Breathe", "category": "space", "phases": P("interplanetary", "interplanetary_hegemon", "post_biological"),
                        "desc": "Terraforming would make Mars a second Earth over centuries ('begin terraforming Mars').", "importance": "Raises the population Mars can support many times over.",
                        "objectives": [{"text": "Raise Mars terraforming to 20%", "cond": {"t": "terraform", "body": "mars", "min": 0.2}}], "rewards": {"legitimacy": 10}, "reward_text": "+10 legitimacy", "deadline": year + 120})
    if "upload" in c["mods"].get("unlocks", []):
        out.append({"key": "digital_constitution", "title": "A Constitution for Minds", "category": "political", "phases": [],
                    "desc": "Mind uploading is now possible. The law must decide whether an uploaded person is the same citizen, a copy, or property.",
                    "importance": "Every choice creates winners, losers and future conflict.", "objectives": [{"text": "Set a digital rights policy (limited or equal)", "cond": {"t": "policy", "policy": "digital_rights", "value": ["limited", "equal"]}}],
                    "rewards": {"stability": 4, "legitimacy": 4}, "reward_text": "+4 stability", "deadline": year + 10})
    if phase == "post_biological":
        out.append({"key": "bio_digital_accord", "title": "The Bio-Digital Accord", "category": "political", "phases": P("post_biological"),
                    "desc": "Digital minds are now the majority. The remaining biological citizens fear marginalisation; some regions talk of secession.",
                    "importance": "A divided civilisation could split along the substrate line.", "objectives": [{"text": "Stability 65%+", "cond": {"t": "stability", "min": 65}}, {"text": "Equal rights for digital persons", "cond": {"t": "policy", "policy": "digital_rights", "value": "equal"}}],
                    "rewards": {"stability": 8}, "reward_text": "+8 stability", "deadline": year + 20})
        out.append({"key": "habitats", "title": "Cities in the Void", "category": "scientific", "phases": P("post_biological", "interplanetary_hegemon"),
                    "desc": "Minds need computation and energy, not planets. Artificial habitats and solar collectors are the natural home of a post-biological civilisation.",
                    "importance": "Opens new territories and energy sources.", "objectives": [{"text": "Research Artificial Habitats", "cond": {"t": "tech", "tech": "artificial_habitats"}}],
                    "rewards": {"research_boost": 0.3}, "reward_text": "Research boost", "deadline": year + 40})
    gc = state["meta"].get("last_great_collapse")
    if gc and gc.get("tag") == tag and year - gc["year"] < 40:
        succ = [t for t in gc.get("successors", []) if state["countries"].get(t, {}).get("alive")]
        if succ:
            out.append({"key": f"guardian:{gc['year']}", "priority": True, "title": "Guardian of the Successor Order", "category": "diplomatic",
                        "desc": f"In {gc['year']} {gc['name']} gave up its empire; {len(succ)} successor states now share its former lands. The old centre can still lead them as a first among equals - or watch them fall upon one another.",
                        "importance": "Without a framework, successor states tend to fight over the imperial inheritance.",
                        "objectives": [{"text": "Belong to an organisation of at least 4 states", "cond": {"t": "org_member", "min_members": 4}}],
                        "rewards": {"legitimacy": 12, "stability": 5}, "reward_text": "+12 legitimacy", "deadline": year + 15})
            out.append({"key": f"reconcile:{gc['year']}", "priority": True, "title": "Reconciliation with the Former Provinces", "category": "diplomatic",
                        "desc": f"Many successor states remember imperial rule bitterly. Winning the trust of {state['countries'][succ[0]]['name']} would show that the empire's end was an act of good faith.",
                        "importance": "Old grievances become new wars.", "actors": succ[:1],
                        "objectives": [{"text": f"{state['countries'][succ[0]]['name']}'s opinion of us at least +20", "cond": {"t": "opinion", "target": succ[0], "min": 20}}],
                        "rewards": {"stability": 6}, "reward_text": "+6 stability", "deadline": year + 20})
            out.append({"key": f"rump:{gc['year']}", "priority": True, "title": "The Rump State", "category": "political",
                        "desc": "Shorn of its empire, the old metropole must redefine itself: its institutions, its economy and its place in history.",
                        "importance": "A smaller state can be a more stable one.", "objectives": [{"text": "Stability at least 65%", "cond": {"t": "stability", "min": 65}}],
                        "rewards": {"legitimacy": 10}, "reward_text": "+10 legitimacy", "deadline": year + 10})
    if phase == "successor_state":
        her = c["heritage"][-1] if c["heritage"] else None
        if her:
            old = [pid for pid, p in provs.items() if her.get("tag") and her["tag"] in p["cores"]]
            out.append({"key": f"legit:{her['name']}", "title": f"Heir of {her['name']}", "category": "political", "phases": P("successor_state"),
                        "desc": f"{c['name']} was born from the fall of {her['name']}. Rival successor states contest which of them is its true heir. Legitimacy must be earned at home first.",
                        "importance": "Legitimacy determines who leads the post-imperial order.", "objectives": [{"text": "Legitimacy 75%+", "cond": {"t": "legitimacy", "min": 75}}],
                        "rewards": {"stability": 6}, "reward_text": "+6 stability", "deadline": year + 15})
            if old:
                out.append({"key": f"reunify:{her['name']}", "title": f"Reunify the Lands of {her['name']}", "category": "military", "phases": P("successor_state", "regional_power", "great_power"),
                            "desc": f"Half the lands of {her['name']} would make {c['name']} its undisputed successor - by persuasion, federation or force.",
                            "importance": "Restoration movements will rally to whoever reunifies the old realm.", "objectives": [{"text": f"Control 50% of the former {her['name']}", "cond": {"t": "control", "provinces": old[:80], "min_share": 0.5}}],
                            "rewards": {"legitimacy": 20, "stability": 8}, "reward_text": "+20 legitimacy", "deadline": year + 40})
            out.append({"key": f"concord:{her['name']}", "title": "A Concord of Successors", "category": "diplomatic", "phases": P("successor_state"),
                        "desc": "The successor states could repeat the wars that destroyed the old order - or bind themselves into a new institution.",
                        "importance": "A collective framework prevents a war of all against all.", "objectives": [{"text": "Belong to an international organisation of 3+ members", "cond": {"t": "org_member", "min_members": 3}}],
                        "rewards": {"stability": 6}, "reward_text": "+6 stability", "deadline": year + 15})
    return out


def hidden_candidates(state: dict, tag: str) -> list[dict]:
    c = state["countries"][tag]
    year = state["meta"]["year"]
    out = []
    if c["stability"] < 45:
        out.append({"key": f"conspiracy:{year // 10}", "title": "Conspiracy in the High Command", "category": "crisis", "hidden": True,
                    "reveal": {"t": "stability", "max": 35},
                    "desc": "Intelligence reports point to officers plotting against the government. Only restored stability will deprive them of support.",
                    "importance": "If the plotters strike, the government falls.", "objectives": [{"text": "Raise stability to 50% before the plot matures", "cond": {"t": "stability", "min": 50}}],
                    "rewards": {"legitimacy": 8}, "failure": {"stability": -15, "legitimacy": -20}, "failure_text": "A coup attempt shakes the state", "deadline": year + 3, "optional": False})
    for th in active_threads(state, tag):
        if th["kind"] == "colonial_tension":
            out.append({"key": f"secession_plot:{th['id']}", "title": "The Secession Plot", "category": "crisis", "hidden": True, "reveal": {"t": "stability", "max": 101},
                        "desc": f"Agents report that leaders of the settlements are secretly preparing a declaration of independence and stockpiling arms. ({th['title']})",
                        "importance": "Discovered in time, the plot can be defused.", "objectives": [{"text": "Resolve the colonial tensions", "cond": {"t": "thread_resolved", "thread": th["id"]}}],
                        "rewards": {"stability": 6}, "deadline": year + 8, "optional": True, "reveal_intel": True})
    return out


def check_missions(state: dict, tag: str, rng) -> None:
    year = state["meta"]["year"] + (state["meta"]["month"] - 1) / 12
    phase = state["meta"].get("phase")
    c = state["countries"].get(tag)
    for m in list(state["missions"].values()):
        if m["status"] != "active":
            continue
        if m["phases"] and phase and phase not in m["phases"]:
            m["status"] = "superseded"
            m["closed"] = state["meta"]["year"]
            m["note"] = f"Overtaken by events: {state['meta'].get('phase_label', phase)}."
            continue
        if m.get("hidden"):
            r = m.get("reveal") or {}
            if r.get("t") == "stability" and c and c["stability"] <= r.get("max", 0) and not m.get("reveal_intel"):
                m["hidden"] = False
                emit(state, "mission", f"Revealed: {m['title']}", m["desc"], [tag], 4, tags=["mission", "hidden"])
            if m["hidden"]:
                if m["deadline"] and year >= m["deadline"]:
                    _fail(state, tag, m)
                continue
        results = [evaluate(state, tag, o["cond"]) for o in m["objectives"]]
        done = any(r[0] for r in results) if m.get("mode") == "any" else all(r[0] for r in results)
        m["progress"] = round(max(r[1] if not r[0] else 1.0 for r in results) if m.get("mode") == "any" else sum(1.0 if r[0] else r[1] for r in results) / len(results), 3)
        for o, r in zip(m["objectives"], results):
            o["done"] = r[0]
        if done:
            m["status"] = "completed"
            m["closed"] = state["meta"]["year"]
            apply_effects(state, tag, m["rewards"])
            emit(state, "mission", f"Mission accomplished: {m['title']}", f"{m['desc'][:240]} Reward: {m.get('reward_text') or 'prestige'}.", [tag], 3, tags=["mission"], data={"mission": m["id"]})
        elif m["deadline"] and year >= m["deadline"]:
            _fail(state, tag, m)


def _fail(state, tag, m):
    m["status"] = "failed" if not m.get("optional", True) else "expired"
    m["closed"] = state["meta"]["year"]
    if m["failure"]:
        apply_effects(state, tag, m["failure"])
    if not m.get("optional", True) or m["failure"]:
        emit(state, "mission", f"Mission failed: {m['title']}", f"The deadline passed. {m.get('failure_text') or ''}", [tag], 3, tags=["mission"])


def apply_effects(state: dict, tag: str, eff: dict) -> None:
    from ..sim.core import compute_mods, stab_add
    c = state["countries"].get(tag)
    if not c:
        return
    if "stability" in eff:
        stab_add(c, eff["stability"])
    if "legitimacy" in eff:
        c["legitimacy"] = clamp(c["legitimacy"] + eff["legitimacy"], 0, 100)
    if "war_support" in eff:
        c["war_support"] = clamp(c.get("war_support", 50) + eff["war_support"], 0, 100)
    if "treasury_gdp" in eff:
        c["treasury"] += c["gdp"] * eff["treasury_gdp"]
    if "research_boost" in eff:
        c["research"]["progress"] = c["research"].get("progress", 0) + c["research"].get("cost", 0) * eff["research_boost"]
    if "prod" in eff:
        c["laws"].append({"name": "Mission dividend", "text": "Lasting gains from an accomplished national mission.", "year": state["meta"]["year"], "eff": {"prod": eff["prod"]}, "kind": "reward"})
        compute_mods(state, c)
    if "integration" in eff or "unrest" in eff:
        for p in state["provinces"].values():
            if p["owner"] == tag:
                p["integ"] = clamp(p["integ"] + eff.get("integration", 0), 0, 100)
                p["unrest"] = clamp(p["unrest"] + eff.get("unrest", 0), 0, 100)


def generate_missions(state: dict, tag: str, max_active: int = 7) -> list[dict]:
    if not state["countries"].get(tag, {}).get("alive"):
        return []
    active = [m for m in state["missions"].values() if m["status"] == "active"]
    created = []
    cands = candidates(state, tag) + hidden_candidates(state, tag)
    prio = {"crisis": 0, "military": 1, "administrative": 2, "political": 2, "space": 3, "diplomatic": 3, "economic": 4, "scientific": 4, "cultural": 5}
    phase = state["meta"].get("phase")
    cands.sort(key=lambda m: (0 if m.get("category") == "crisis" or m.get("priority") else 1 if phase in (m.get("phases") or []) else 2, prio.get(m.get("category"), 5)))
    for m in cands:
        limit = max_active + (4 if phase in (m.get("phases") or []) else 0)
        if len(active) + len(created) >= limit and m.get("category") not in ("crisis",) and not m.get("hidden") and not m.get("priority"):
            continue
        nm = add_mission(state, m, source="engine", origin=m.get("origin"))
        if nm:
            created.append(nm)
            if not nm["hidden"]:
                emit(state, "mission", f"New objective: {nm['title']}", nm["desc"][:300], [tag], 2, tags=["mission"], data={"mission": nm["id"]})
    return created


def reveal_hidden(state: dict, tag: str) -> list[dict]:
    out = []
    for m in state["missions"].values():
        if m["status"] == "active" and m.get("hidden"):
            m["hidden"] = False
            out.append(m)
    return out
