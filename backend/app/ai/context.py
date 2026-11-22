"""Compact, retrieval-based context for AI prompts: structured world state plus relevant history,
instead of the whole campaign log."""
from __future__ import annotations

from ..memory.store import retrieve
from ..sim.core import allies, alive, total_power, wars_of
from ..story.threads import active_threads
from ..util import fmt_money, fmt_pop
from ..world.ideologies import get_ideology
from ..world.techtree import all_techs


def country_line(state: dict, t: str) -> str:
    c = state["countries"][t]
    return (f"{t}: {c['name']} | {c['gov']} ({get_ideology(state, c['ideology'])['name']}) | leader {c['leader']['name']} ({c['leader']['title']}) | "
            f"GDP {fmt_money(c['gdp'])} | pop {fmt_pop(c['pop'])} | stability {c['stability']:.0f}")


def build_context(state: dict, cid: str, focus: str | None = None, query: str = "", k: int = 10) -> str:
    m = state["meta"]
    p = m.get("player")
    lines = [f"DATE: {m['year']}-{m['month']:02d}. ERA: {m.get('era')}. POLITICAL PERIOD: {m.get('period')}."]
    if p and state["countries"].get(p, {}).get("alive"):
        c = state["countries"][p]
        at = all_techs(state)
        recent = sorted(c["techs"], key=lambda x: -at.get(x, {}).get("tier", 0))[:5]
        lines.append(f"PLAYER STATE ({m.get('phase_label', '')}): " + country_line(state, p))
        lines.append(f"  Newest technologies: {', '.join(at[x]['name'] for x in recent if x in at)}")
        lines.append(f"  Allies: {', '.join(state['countries'][a]['name'] for a in sorted(allies(state, p))) or 'none'}")
        ws = wars_of(state, p)
        if ws:
            lines.append("  Wars: " + "; ".join(f"{w['name']} (since {w['start']}, score {w['score'] if p in w['att'] else -w['score']:+.0f})" for w in ws))
        mem = sorted(c["memories"], key=lambda x: -abs(x["w"]))[:5]
        if mem:
            lines.append("  National memory: " + " | ".join(f"{x['y']}: {x['text']}" for x in mem))
        if c.get("heritage"):
            lines.append("  Heritage: " + ", ".join(h["name"] for h in c["heritage"]))
    top = sorted(alive(state), key=lambda t: -total_power(state["countries"][t]))[:8]
    lines.append("GREAT POWERS: " + " || ".join(country_line(state, t) for t in top))
    if focus and focus in state["countries"]:
        lines.append("FOCUS COUNTRY: " + country_line(state, focus))
    ths = sorted(active_threads(state), key=lambda th: -th["tension"])[:8]
    if ths:
        lines.append("ACTIVE STORYLINES: " + " | ".join(f"{th['title']} (since {th['started']}, tension {th['tension']:.0f})" for th in ths))
    ms = [x for x in state["missions"].values() if x["status"] == "active" and not x.get("hidden")]
    if ms:
        lines.append("PLAYER MISSIONS: " + "; ".join(x["title"] for x in ms[:8]))
    r = retrieve(cid, query or " ".join(filter(None, [state["countries"].get(focus or p or "", {}).get("name", "")])), [x for x in (p, focus) if x], m["year"], k)
    if r["summaries"]:
        lines.append("HISTORICAL SUMMARIES: " + " || ".join(f"{s['title']}: {s['body'][:400]}" for s in r["summaries"]))
    if r["events"]:
        lines.append("RELEVANT RECORDED EVENTS: " + " | ".join(f"{e['year']}: {e['title']}" for e in r["events"]))
    return "\n".join(lines)
