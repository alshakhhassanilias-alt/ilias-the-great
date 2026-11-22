"""The Chief Strategist: situation analysis, warnings, opportunities and answers to questions."""
from __future__ import annotations

import re

from ..ai.context import build_context
from ..ai.providers import generate
from ..memory.store import query_events, retrieve
from ..sim.core import alive, allies, idx, land_power, total_power, wars_of, world_totals
from ..sim.relations import neighbors_of, opinion
from ..util import fmt_money
from ..world.geo import BODIES
from ..world.techtree import all_techs, available
from .threads import active_threads


def analyse(state: dict) -> dict:
    p = state["meta"]["player"]
    c = state["countries"][p]
    provs = state["provinces"]
    year = state["meta"]["year"]
    warnings, opps = [], []

    def W(sev, title, text, order=None):
        warnings.append({"severity": sev, "title": title, "text": text, "order": order})

    def O(title, text, order=None, score=1.0):
        opps.append({"title": title, "text": text, "order": order, "score": score})
    if c["stability"] < 40:
        W(3 if c["stability"] < 20 else 2, "Stability is dangerously low", f"Stability {c['stability']:.0f}%. Below 18% revolution or civil war becomes likely. Raise welfare spending, end wars, or grant concessions.", "Set welfare spending to 6% of GDP")
    hot = [pid for pid in idx(state)["owned"].get(p, []) if provs[pid]["unrest"] > 60]
    if hot:
        from ..sim.war import _pname
        W(2, f"{len(hot)} province(s) near revolt", "High unrest in " + ", ".join(_pname(state, x) for x in hot[:5]) + ". Above 68% they may rise in rebellion.", "Grant autonomy to the restless provinces")
    for w in wars_of(state, p):
        sc = w["score"] if p in w["att"] else -w["score"]
        if sc < -20:
            W(3, f"Losing the {w['name']}", f"War score {sc:+.0f}. Consider a negotiated peace before capitulation.", f"Make peace with {state['countries'][w['lead_def'] if p in w['att'] else w['lead_att']]['name']}")
        elif sc > 40:
            O(f"Victory within reach in the {w['name']}", f"War score {sc:+.0f}. We could impose terms now.", f"Make peace with {state['countries'][w['lead_def'] if p in w['att'] else w['lead_att']]['name']} and annex occupied territory", 3)
    if c["debt"] > c["gdp"] * 0.9:
        W(2, "Debt crisis looming", f"Debt {fmt_money(c['debt'])} exceeds 90% of GDP; growth and stability will suffer.", "Set military spending to 3% of GDP")
    for o in state["orgs"].values():
        if o.get("target") == p:
            W(3, o["name"], f"{len(o['members'])} states have united against us.", None)
    for th in active_threads(state, p):
        if th["kind"] in ("colonial_tension", "digital_rights", "ai_rights", "succession", "overstretch") and th["tension"] > 40:
            W(2, th["title"], th["summary"] + f" (tension {th['tension']:.0f})", None)
    for o in alive(state):
        oc = state["countries"][o]
        claims = sum(1 for pid in oc["claims"] if provs.get(pid, {}).get("owner") == p)
        if claims and total_power(oc) > total_power(c) * 0.8 and opinion(state, o, p) < -20 and oc["leader"]["traits"]["agg"] > 0.5:
            W(2, f"{oc['name']} covets our land", f"{oc['name']} claims {claims} of our provinces, is militarily comparable and led by the aggressive {oc['leader']['name']}.", f"Propose a defensive pact with {_best_ally(state, p, o)}")
    for m in state["missions"].values():
        if m["status"] == "active" and m.get("deadline") and m["deadline"] - year <= 2 and not m.get("hidden") and not m.get("optional", True):
            W(1, f"Deadline: {m['title']}", f"Due by {m['deadline']}; progress {m.get('progress', 0) * 100:.0f}%.", None)
    # opportunities
    for o in sorted(neighbors_of(state, p)):
        oc = state["countries"][o]
        claims = [pid for pid in c["claims"] if provs.get(pid, {}).get("owner") == o]
        ratio = land_power(c) / max(0.01, land_power(oc) + sum(land_power(state["countries"][a]) for a in sorted(allies(state, o))))
        if claims and ratio > 1.8:
            O(f"{oc['name']} is vulnerable", f"We claim {len(claims)} of its provinces and outmatch it and its allies {ratio:.1f}:1.", f"Declare war on {oc['name']}", ratio)
    for o in alive(state):
        if o == p or o in allies(state, p):
            continue
        op = opinion(state, o, p)
        if op > 35 and total_power(state["countries"][o]) > 0.3:
            O(f"{state['countries'][o]['name']} is friendly", f"Opinion {op:+.0f}. An alliance is within reach.", f"Propose an alliance with {state['countries'][o]['name']}", op / 30)
    at = all_techs(state)
    for t in available(state, set(c["techs"])):
        if t["eff"].get("unlock"):
            O(f"Frontier technology: {t['name']}", t["desc"], f"Research {t['name']}", 1.5)
            break
    for body, b in BODIES.items():
        if b["requires"] in c["techs"] and body in state["bodies"]:
            free = [pid for pid, x in provs.items() if x["body"] == body and not x["owner"]]
            if free and not any(pr["kind"] == "colonize" for pr in c["projects"]):
                O(f"Unclaimed land on {b['name']}", f"{len(free)} regions remain unclaimed.", f"Colonize {b['name'].split(' (')[0]}", 2)
                break
    share = c["budget"].get("research", 0)
    if share < 0.02 and year > 1950:
        O("Underfunded science", f"Research spending is {share * 100:.1f}% of GDP.", "Invest 4% of GDP into scientific research", 1.2)
    opps.sort(key=lambda x: -x["score"])
    warnings.sort(key=lambda x: -x["severity"])
    tot = world_totals(state)
    rank = sorted(alive(state), key=lambda t: -total_power(state["countries"][t])).index(p) + 1
    summary = (f"{c['name']} ranks #{rank} in military power and produces {100 * c['gdp'] / tot['gdp']:.1f}% of world output. "
               f"Phase: {state['meta'].get('phase_label')}. {len(warnings)} warning(s), {len(opps)} opportunit{'y' if len(opps) == 1 else 'ies'}.")
    return {"summary": summary, "warnings": warnings[:8], "opportunities": opps[:8], "advisor": _advisor_name(state)}


def _best_ally(state, p, threat):
    cands = sorted((o for o in alive(state) if o not in (p, threat)), key=lambda o: -(opinion(state, o, p) - opinion(state, o, threat) + total_power(state["countries"][o]) * 2))
    return state["countries"][cands[0]]["name"] if cands else "a neighbour"


def _advisor_name(state):
    from ..world.names import person
    from ..util import rng_for
    p = state["meta"]["player"]
    c = state["countries"][p]
    rng = rng_for(state["meta"]["seed"], "advisor", p, c.get("founded"))
    year = state["meta"]["year"]
    if year > 2150:
        return {"name": f"STRATEGOS-{rng.randint(2, 99)}", "title": "Strategic Intelligence"}
    return {"name": person(rng, c["culture"]), "title": "Chief Strategist"}


def ask(state: dict, cid: str, question: str) -> dict:
    p = state["meta"]["player"]
    an = analyse(state)
    ctx = build_context(state, cid, query=question)
    txt = generate("advisor", f"You are {an['advisor']['name']}, {an['advisor']['title']} to the head of state in a historical simulation. Answer in character, concisely (under 250 words), using ONLY the supplied facts. Recommend concrete orders when useful.",
                   f"{ctx}\nANALYSIS: {an['summary']} WARNINGS: {[w['title'] for w in an['warnings']]} OPPORTUNITIES: {[o['title'] for o in an['opportunities']]}\nQUESTION: {question}", 900)
    if txt:
        return {"answer": txt, "source": "ai", "advisor": an["advisor"]}
    low = question.lower()
    c = state["countries"][p]
    parts = []
    if re.search(r"threat|danger|enemy|rival|afraid|worry", low):
        ths = [w for w in an["warnings"]] or []
        top = sorted((o for o in alive(state) if o != p), key=lambda o: opinion(state, o, p) - total_power(state["countries"][o]) * 3)[:3]
        parts.append("Our gravest dangers: " + "; ".join(f"{state['countries'][o]['name']} (opinion {opinion(state, o, p):+.0f}, power {total_power(state['countries'][o]):.1f} vs our {total_power(c):.1f})" for o in top) + ".")
        parts += [w["text"] for w in ths[:2]]
    if re.search(r"\bwar|front|winning|losing|battle", low):
        ws = wars_of(state, p)
        parts.append(" ".join(f"In the {w['name']} the war score stands at {(w['score'] if p in w['att'] else -w['score']):+.0f}; our exhaustion is {w['exh'].get(p, 0):.0f}%." for w in ws) or "We are at peace.")
    if re.search(r"econom|gdp|money|budget|debt|growth", low):
        parts.append(f"GDP {fmt_money(c['gdp'])} (prior year {fmt_money(c.get('prev_gdp', c['gdp']))}); treasury {fmt_money(c['treasury'])}; debt {fmt_money(c['debt'])}. Budget: " +
                     ", ".join(f"{k} {v * 100:.1f}%" for k, v in c["budget"].items()) + ".")
    if re.search(r"mars|space|moon|coloni|planet", low):
        off = [x for x in state["provinces"].values() if x["owner"] == p and x["body"] != "earth"]
        parts.append(f"We hold {len(off)} off-world region(s) with {sum(x['pop'] for x in off) * 1e6:,.0f} settlers. Bodies open to settlement: {', '.join(b['name'] for b in state['bodies'].values()) or 'none yet'}.")
    if re.search(r"histor|remember|past|why|when did|origin|happened", low) or not parts:
        r = retrieve(cid, question, [p], state["meta"]["year"], 6)
        if r["events"]:
            parts.append("The records recall: " + " ".join(f"{e['year']}: {e['title']}." for e in r["events"][:6]))
    if re.search(r"should|advice|recommend|next|do now|plan|strategy", low) or len(parts) < 2:
        if an["opportunities"]:
            parts.append("I recommend: " + "; ".join(f"{o['title']} - order: “{o['order']}”" for o in an["opportunities"][:3] if o["order"]) + ".")
        if an["warnings"]:
            parts.append("Beware: " + "; ".join(w["title"] for w in an["warnings"][:3]) + ".")
    return {"answer": " ".join(parts), "source": "offline", "advisor": an["advisor"]}
