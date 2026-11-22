"""Narrative generation grounded in the campaign record: historical briefings, era-adaptive newspapers and
chronicles/textbooks. Offline generators compose text strictly from recorded events; when an AI provider is
configured it rewrites the same facts with instructions never to invent events."""
from __future__ import annotations

import re

from ..ai.context import build_context
from ..ai.providers import generate, generate_json
from ..memory.store import list_summaries, query_events
from ..sim.core import allies, alive, total_power, wars_of
from ..sim.relations import opinion
from ..util import fmt_money, fmt_pop, rng_for, year_str
from ..world.ideologies import get_ideology
from ..world.names import masthead
from .threads import active_threads


# ---------------------------------------------------------------- briefing

def briefing(state: dict, cid: str) -> dict:
    m = state["meta"]
    p = m.get("player")
    c = state["countries"][p]
    ide = get_ideology(state, c["ideology"])
    top = sorted(alive(state), key=lambda t: -total_power(state["countries"][t]))[:8]
    sections = []
    sections.append({"title": "The World", "kind": "established", "body": m.get("world_background", "") + f" Historians call this the {m.get('era')}; politically it is the {m.get('period')}."})
    nat = c.get("origin") or f"{c['name']} enters history as a {c['gov']}."
    sections.append({"title": f"The Nation: {c['name']}", "kind": "established",
                     "body": f"{nat} Today it is a {c['gov']} guided by {ide['name']} - {ide['desc']} It is led by {c['leader']['name']}, {c['leader']['title']}. "
                             f"Its economy produces {fmt_money(c['gdp'])} a year (${c['gdp'] * 1000 / max(1e-6, c['pop']):,.0f} per person) for {fmt_pop(c['pop'])} people; "
                             f"the army numbers some {c['army']:,.0f} thousand, and the state is {'stable' if c['stability'] > 60 else 'troubled' if c['stability'] > 35 else 'close to collapse'} ({c['stability']:.0f}%)."})
    mem = sorted([x for x in c["memories"]], key=lambda x: -abs(x["w"]))[:7]
    if mem:
        sections.append({"title": "National Memory", "kind": "established", "body": " ".join(f"{x['y']}: {x['text']}" for x in sorted(mem, key=lambda x: x["y"]))})
    friends = sorted(allies(state, p))
    rivals = sorted((t for t in alive(state) if t != p), key=lambda t: opinion(state, t, p))[:4]
    rel = []
    if friends:
        rel.append("Allies and partners: " + ", ".join(state["countries"][t]["name"] for t in friends) + ".")
    rel.append("Most hostile governments: " + ", ".join(f"{state['countries'][t]['name']} ({opinion(state, t, p):+.0f})" for t in rivals) + ".")
    claims = {}
    for pid in c["claims"]:
        o = state["provinces"].get(pid, {}).get("owner")
        if o and o != p:
            claims.setdefault(o, 0)
            claims[o] += 1
    if claims:
        rel.append("Territorial claims: " + ", ".join(f"{n} province(s) held by {state['countries'][o]['name']}" for o, n in claims.items()) + ".")
    ws = wars_of(state, p)
    if ws:
        rel.append("At war: " + "; ".join(w["name"] for w in ws) + ".")
    sections.append({"title": "Diplomatic Situation", "kind": "current", "body": " ".join(rel)})
    sections.append({"title": "The Great Powers", "kind": "current", "body": " ".join(
        f"{state['countries'][t]['name']} - {state['countries'][t]['gov']} under {state['countries'][t]['leader']['name']}; GDP {fmt_money(state['countries'][t]['gdp'])}." for t in top)})
    hist = query_events(cid, kinds=["history"], limit=40, order="asc")
    if hist:
        sections.append({"title": "Established History", "kind": "established", "body": " ".join(f"{year_str(e['year'])}: {e['body']}" for e in hist if e["year"] < m["start_year"])[:4000]})
    if m.get("divergence"):
        alt = query_events(cid, kinds=["divergence"], limit=20, order="asc")
        sections.append({"title": "Point of Divergence (Alternate History)", "kind": "alternate",
                         "body": f"In this timeline: {m['divergence']} " + " ".join(e["body"] for e in alt)})
    ms = [x for x in state["missions"].values() if x["status"] == "active" and not x.get("hidden")]
    if ms:
        sections.append({"title": "Pressing Matters", "kind": "objectives", "body": " ".join(f"{x['title']}: {x['desc'][:160]}" for x in ms[:6])})
    narrative = None
    txt = generate("briefing", "You are the chief historian of a grand-strategy simulation. Write an evocative but strictly factual intelligence briefing (5 short paragraphs) for the head of state. Use ONLY the facts given; clearly mark alternate-history developments as such; invent no events.",
                   build_context(state, cid, query="history origins war treaty") + "\n\nBRIEFING SECTIONS:\n" + "\n".join(f"[{s['title']}] {s['body']}" for s in sections), 1800)
    if txt:
        narrative = txt
    return {"title": f"Briefing for {c['leader']['title']} {c['leader']['name']}, {m['month']:02d}/{m['year']}", "sections": sections, "narrative": narrative}


# ---------------------------------------------------------------- newspapers

def paper_style(year: int) -> str:
    if year < 1800:
        return "broadside"
    if year < 1950:
        return "broadsheet"
    if year < 2030:
        return "modern"
    if year < 2200:
        return "feed"
    if year < 3000:
        return "neural"
    return "weave"


def _headline(title: str, style: str) -> str:
    if style in ("broadside", "broadsheet"):
        return title.upper() + ("!" if not title.endswith(("!", "?")) and len(title) < 60 else "")
    if style == "feed":
        return "BREAKING · " + title
    if style == "neural":
        return "◈ " + title
    if style == "weave":
        return "∞ " + title.lower()
    return title


QUOTES = {
    "hostile": ["This is an outrage that will not go unanswered.", "{c} will remember this day.", "We condemn this in the strongest terms."],
    "wary": ["We are watching developments with great concern.", "{c} calls for restraint from all parties.", "We urge calm and dialogue."],
    "friendly": ["{c} stands with its friends.", "This is a welcome development for peace and prosperity.", "We congratulate the government on its achievement."],
}


def _reaction(state: dict, e: dict, rng) -> list[dict]:
    out = []
    main = e["actors"][0] if e["actors"] else None
    if not main or e["kind"] not in ("war", "peace", "collapse", "science", "space", "diplomacy", "government", "independence", "law", "ideology", "civil_war", "catastrophe"):
        return out
    cands = [t for t in sorted(alive(state), key=lambda t: -total_power(state["countries"][t]))[:10] if t not in e["actors"]]
    for t in cands[:2]:
        op = opinion(state, t, main) if main in state["countries"] else 0
        stance = "hostile" if op < -25 or (e["kind"] == "war" and op < 10) else "friendly" if op > 25 else "wary"
        c = state["countries"][t]
        q = rng.choice(QUOTES[stance]).format(c=c["name"])
        out.append({"speaker": f"{c['leader']['name']}, {c['leader']['title']} of {c['name']}", "quote": q, "stance": stance})
    return out


ADS = {
    "broadside": ["Fine Spices from the East - Inquire at the Harbour", "Notice: Taxes Due at Midsummer"],
    "broadsheet": ["Buy National Savings Bonds!", "New Wireless Sets - Hear the World!", "Motor Cars for the Modern Family"],
    "modern": ["Upgrade your phone today", "Fly anywhere this summer", "Invest in the future: national bonds"],
    "feed": ["Neural lace upgrades - 0% financing", "Lunar holidays: book now", "Your AI assistant, now with feelings*"],
    "neural": ["Fork yourself for the weekend - safely", "Orbital habitat timeshares", "Memory backup, guaranteed for a millennium"],
    "weave": ["contemplate a new substrate", "the archive remembers you", "join a chorus"],
}


def newspaper(state: dict, cid: str, year: int | None = None, month: int | None = None, country: str | None = None, months_back: int = 12) -> dict:
    m = state["meta"]
    year = year or m["year"]
    month = month or m["month"]
    country = country or m.get("player")
    c = state["countries"].get(country) or next(iter(state["countries"].values()))
    rng = rng_for(m["seed"], "paper", year, month, country)
    style = paper_style(year)
    y0 = year - max(1, months_back // 12)
    evs = [e for e in query_events(cid, year_from=y0, year_to=year, min_importance=2, limit=300) if not e["backstory"] and "secret" not in e["tags"]
           and e["kind"] not in ("decision", "decision_made", "mission", "order")]
    evs = [e for e in evs if (e["year"], e["month"]) <= (year, month)]

    def score(e):
        s = e["importance"] * 10 + (8 if country in e["actors"] else 0) - (year - e["year"]) * 2
        return s + rng.random()
    evs.sort(key=score, reverse=True)
    lead = evs[:1]
    rest = evs[1:9]
    name = masthead(rng, c["name"], c["adj"], year)
    articles = []
    for i, e in enumerate(lead + rest):
        body = e["body"] or e["title"]
        articles.append({"headline": _headline(e["title"], style), "body": body, "year": e["year"], "month": e["month"], "kind": e["kind"],
                         "lead": i == 0, "reactions": _reaction(state, e, rng) if i < 3 else [], "event_id": e["id"]})
    briefs = [f"{e['year']}: {e['title']}" for e in evs[9:16]]
    issue = {"masthead": name, "style": style, "year": year, "month": month, "country": country, "articles": articles, "briefs": briefs,
             "ads": ADS[style][:], "price": {"broadside": "One Penny", "broadsheet": "2 cents", "modern": "$1.50", "feed": "free with attention", "neural": "0.002 compute-credits", "weave": "—"}[style],
             "editorial": None, "source": "offline"}
    if articles:
        out = generate_json("newspapers", "You are the editor of a newspaper inside a historical simulation. Rewrite the given articles in the voice, vocabulary and technology of the era and the outlook of the paper's country. NEVER add events, numbers or names not present in the input. Return JSON {\"articles\":[{\"headline\":..., \"body\":...}], \"editorial\": \"short opinion column\"} with the same number and order of articles.",
                            f"Paper: {name} ({c['name']}), issue of {month:02d}/{year}, era style: {style}.\nArticles:\n" + "\n".join(f"{i+1}. {a['headline']} :: {a['body']}" for i, a in enumerate(articles)), 2500)
        if out and isinstance(out.get("articles"), list) and len(out["articles"]) == len(articles):
            for a, b in zip(articles, out["articles"]):
                if isinstance(b, dict) and b.get("headline") and b.get("body"):
                    a["headline"], a["body"] = str(b["headline"])[:200], str(b["body"])[:2000]
            issue["editorial"] = str(out.get("editorial", ""))[:2000] or None
            issue["source"] = "ai"
    if not issue["editorial"] and articles:
        e0 = lead[0]
        ide = get_ideology(state, c["ideology"])
        issue["editorial"] = f"The editors of {name} observe that '{e0['title']}' will be remembered as the defining story of these months. Seen from {c['name']}, under {ide['name']}, its consequences are only beginning."
    return issue


# ---------------------------------------------------------------- chronicle / histories

TOPIC_WORDS = {
    "mars": (["mars", "martian", "tharsis", "hellas"], ["space"]), "moon": (["luna", "lunar", "moon"], ["space"]),
    "independence": (["independence", "independent", "secession"], ["independence", "revolt", "space"]),
    "digital": (["digital", "upload", "consciousness", "minds"], ["society", "law", "ideology"]),
    "collapse": (["collapse", "successor", "dissolution", "fall"], ["collapse", "restoration", "independence"]),
    "war": (["war", "battle", "invasion"], ["war", "war_end", "battle", "peace"]),
    "science": (["technology", "science", "research", "discovery"], ["science"]),
    "planetary": (["planetary", "world government", "global"], ["government", "law", "chapter"]),
}


def parse_request(state: dict, text: str) -> dict:
    from ..orders.parser import find_countries
    years = [int(y) for y in re.findall(r"\b(\d{3,5})\b", text)]
    tags = find_countries(state, text)
    if not tags:
        low = text.lower()
        for t, c in state["countries"].items():
            if c["name"].lower() in low or (c["adj"].lower() + " ") in low:
                tags.append(t)
    topics = [k for k, (words, _) in TOPIC_WORDS.items() if any(w in text.lower() for w in words)]
    form = "textbook" if "textbook" in text.lower() else "explanation" if re.search(r"\bexplain|why|how\b", text.lower()) else "history"
    return {"countries": tags[:3], "from": min(years) if years else None, "to": max(years) if len(years) > 1 else None, "topics": topics, "form": form}


def write_history(state: dict, cid: str, request: str) -> dict:
    req = parse_request(state, request)
    m = state["meta"]
    y0 = req["from"] if req["from"] is not None else -100000
    y1 = req["to"] if req["to"] is not None else m["year"]
    kinds = sorted({k for t in req["topics"] for k in TOPIC_WORDS[t][1]}) or None
    evs: dict[int, dict] = {}
    if req["countries"]:
        for t in req["countries"]:
            for e in query_events(cid, actor=t, year_from=y0, year_to=y1, min_importance=3, limit=6000, order="asc", kinds=kinds):
                evs[e["id"]] = e
    if req["topics"]:
        words = " ".join(w for t in req["topics"] for w in TOPIC_WORDS[t][0])
        for e in query_events(cid, q=words, year_from=y0, year_to=y1, limit=200):
            if e["importance"] >= 2:
                evs[e["id"]] = e
    if not evs:
        for e in query_events(cid, year_from=y0, year_to=y1, min_importance=4, limit=400, order="asc"):
            evs[e["id"]] = e
    events = sorted(evs.values(), key=lambda e: (e["year"], e["month"], e["id"]))
    if len(events) > 400:
        # keep every major event and an even sample of the rest so the whole period is covered
        major = [e for e in events if e["importance"] >= 4]
        rest = [e for e in events if e["importance"] < 4]
        step = max(1, len(rest) // max(1, 400 - len(major)))
        events = sorted(major + rest[::step], key=lambda e: (e["year"], e["month"], e["id"]))
        if len(events) > 600:
            events = [e for e in events if e["importance"] >= 4] or events[:600]
    subject = " and ".join(state["countries"][t]["name"] for t in req["countries"]) or (", ".join(req["topics"]).title() or "the World")
    span = f"{year_str(events[0]['year'])}–{year_str(events[-1]['year'])}" if events else ""
    title = {"textbook": f"Textbook: {subject}", "explanation": f"Understanding {subject}", "history": f"A History of {subject}"}[req["form"]] + (f", {span}" if span else "")
    chapters = []
    if events:
        n = max(1, min(8, len(events) // 6))
        first, last = events[0]["year"], events[-1]["year"]
        width = max(1, (last - first + 1) / n)
        for i in range(n):
            a, b = first + int(i * width), first + int((i + 1) * width) - (0 if i == n - 1 else 1)
            if i == n - 1:
                b = last
            ce = [e for e in events if a <= e["year"] <= b]
            if not ce:
                continue
            key = max(ce, key=lambda e: e["importance"])
            body = _narrate(ce)
            chapters.append({"title": f"{year_str(a)}–{year_str(b)}: {key['title']}", "body": body, "events": [e["id"] for e in ce][:60]})
    sums = [s for s in list_summaries(cid) if s["start_year"] >= y0 and s["end_year"] <= y1 and s["level"] == "century"]
    doc = {"title": title, "request": request, "chapters": chapters, "sources": len(events), "source": "offline", "body": None,
           "note": "Compiled exclusively from the campaign's recorded events." if events else "The records contain no events matching this request."}
    if events:
        facts = "\n".join(f"{e['year']}: {e['title']} - {e['body'][:220]}" for e in events[:160])
        txt = generate("chronicle", "You are a historian inside a simulated world. Write the requested history using ONLY the recorded events supplied. Do not invent events, people, dates or numbers. Organise it into titled sections with analysis of causes and consequences. Markdown headings allowed.",
                       f"REQUEST: {request}\nCENTURY SUMMARIES: {' | '.join(s['body'] for s in sums)[:3000]}\nRECORDED EVENTS ({len(events)}):\n{facts}", 3500)
        if txt:
            doc["body"] = txt
            doc["source"] = "ai"
    return doc


CONNECT = ["In {y},", "By {y},", "Then, in {y},", "The year {y} saw", "{y} brought", "Later, in {y},"]


def _narrate(events: list[dict]) -> str:
    out = []
    major = [e for e in events if e["importance"] >= 3] or events
    for i, e in enumerate(major[:14]):
        con = CONNECT[i % len(CONNECT)].format(y=year_str(e["year"]))
        body = e["body"] or e["title"]
        sentence = body.split(". ")[0].rstrip(".")
        if con.endswith(","):
            out.append(f"{con} {sentence[0].lower() + sentence[1:] if sentence[:1].isupper() and not sentence.split(' ')[0].istitle() else sentence}.")
        else:
            out.append(f"{con} {e['title'][0].lower() + e['title'][1:] if not e['title'].split(' ')[0].istitle() else e['title']}: {sentence}.")
    if len(major) > 14:
        out.append(f"Another {len(major) - 14} recorded developments of note followed in this period.")
    return " ".join(out)
