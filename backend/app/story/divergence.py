"""Alternate-history points of divergence: free-text premises turned into validated world modifications."""
from __future__ import annotations

import re

from ..ai.providers import generate_json
from ..sim.core import build_index, emit, idx
from ..world.ideologies import BASE


def apply_divergence(state: dict, text: str, rng) -> list[str]:
    applied: list[str] = []
    if not text or not text.strip():
        return applied
    from ..orders.parser import find_countries, GOV_WORDS
    from ..orders.executor import execute_actions
    tags = "; ".join(f"{t}={c['name']}" for t, c in state["countries"].items() if c["alive"])
    ai = generate_json("orders", "You convert an alternate-history premise into concrete modifications of a world simulation. Return JSON {\"changes\":[{\"actor\":TAG, \"action\":{...}}]} using action types: declare_war{target}, propose_treaty{target,treaty}, change_government{ideology,gov}, annex_peacefully{target}, dismantle_empire{mode}, research{tech}, set_policy{policy,value}. Use only listed tags. At most 8 changes.",
                       f"PREMISE: {text}\nYEAR: {state['meta']['year']}\nCOUNTRIES: {tags[:6000]}\nIDEOLOGIES: {', '.join(BASE)}", 1500)
    if ai and isinstance(ai.get("changes"), list):
        for ch in ai["changes"][:8]:
            actor, act = ch.get("actor"), ch.get("action")
            if actor in state["countries"] and isinstance(act, dict) and act.get("type"):
                if act["type"] == "annex_peacefully":
                    act = dict(act)
                res = execute_actions(state, actor, [act], rng, source="history")
                for r in res["results"]:
                    if r["ok"]:
                        applied.append(f"{state['countries'][actor]['name']}: {r['message']}")
    else:
        for sent in re.split(r"[.;]\s*|\band\b(?=\s+[A-Z])", text):
            s = sent.strip()
            if not s:
                continue
            low = s.lower()
            cs = find_countries(state, s)
            if len(cs) >= 2 and re.search(r"\b(controls?|owns?|rules?|annex(ed|es)?|conquered|absorbed|includes?|took)\b", low):
                res = execute_actions(state, cs[0], [{"type": "annex_peacefully", "target": cs[1]}], rng, source="history")
                applied += [r["message"] for r in res["results"] if r["ok"]]
            elif len(cs) >= 2 and re.search(r"\b(allied|alliance|allies)\b", low):
                state["treaties"].append({"id": f"dv{len(state['treaties'])}", "type": "alliance", "members": cs[:2], "since": state["meta"]["year"], "name": "Alliance (divergence)", "secret": False})
                applied.append(f"{state['countries'][cs[0]]['name']} and {state['countries'][cs[1]]['name']} are allied.")
            elif len(cs) >= 2 and re.search(r"\b(at war|war with|war against|invaded|invades)\b", low):
                from ..sim.war import start_war
                start_war(state, cs[0], cs[1], "conquest")
                applied.append(f"{state['countries'][cs[0]]['name']} is at war with {state['countries'][cs[1]]['name']}.")
            elif cs and re.search(r"\b(collapsed|fell apart|broke up|dissolved|never unified|fragmented)\b", low):
                res = execute_actions(state, cs[0], [{"type": "dismantle_empire", "mode": "collapse"}], rng, source="history")
                applied += [r["message"] for r in res["results"] if r["ok"]]
            elif cs:
                for word, ide, gov, title in GOV_WORDS:
                    if word in low and re.search(r"\b(is|became|becomes|remained|stayed|turned)\b", low):
                        res = execute_actions(state, cs[0], [{"type": "change_government", "ideology": ide, "gov": gov, "title": title}], rng, source="history")
                        applied += [f"{state['countries'][cs[0]]['name']}: {r['message']}" for r in res["results"] if r["ok"]]
                        break
    build_index(state)
    emit(state, "divergence", "Point of divergence", f"In this timeline, history took another path: {text}" + (" Consequences: " + " ".join(applied) if applied else ""),
         [], 5, tags=["divergence", "alternate"])
    for c in state["countries"].values():
        c["stability"] = max(30.0, c["stability"])
    return applied
