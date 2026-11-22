"""Direct diplomacy with AI leaders. Outcomes are decided deterministically from interests, personality,
power and historical memory; language models (if configured) only voice the leader's reply."""
from __future__ import annotations

import re

from ..ai.providers import generate
from ..sim.core import add_memory, allies, at_war, emit, total_power, treaty_between, wars_of
from ..sim.relations import modify, opinion, trust
from ..world.ideologies import get_ideology


def classify(msg: str) -> str:
    low = msg.lower()
    rules = [("peace", r"\b(peace|ceasefire|armistice|end (this|the) war|stop fighting)\b"),
             ("joint_war", r"\b(together|join (us|me)|joint|common enemy)\b.*\b(war|attack|against|fight)\b|\bagainst\b.*\b(together|with us)\b"),
             ("alliance", r"\b(alliance|ally|allies)\b"), ("defensive_pact", r"\b(defensive pact|mutual defen[cs]e|protect each other)\b"),
             ("non_aggression", r"\b(non-aggression|nonaggression|not attack|won't attack|will not attack)\b"),
             ("trade", r"\b(trade|commerce|tariff|economic (cooperation|agreement))\b"),
             ("subjugation", r"\b(submit|vassal|become our (subject|protectorate)|swear fealty)\b"),
             ("union", r"\b(unite|union|federation|join (our|the) (state|federation|empire)|merge)\b"),
             ("demand", r"\b(demand|hand over|give us|cede|surrender)\b"),
             ("threat", r"\b(or else|you will regret|we will destroy|crush you|threat|warn you)\b"),
             ("aid", r"\b(aid|gift|loan|help you|offer you|assistance)\b"), ("promise", r"\b(promise|pledge|guarantee|assure you|swear)\b"),
             ("insult", r"\b(fool|coward|pathetic|weak|traitor|barbarian|idiot)\b"), ("apology", r"\b(apolog|sorry|regret|forgive)\b"),
             ("history", r"\b(remember|history|past|why do you|grievance|what do you think of)\b"), ("intentions", r"\b(intend|plan|ambition|want|goal)\b")]
    for k, pat in rules:
        if re.search(pat, low):
            return k
    return "greeting"


NEED = {"alliance": 35, "defensive_pact": 20, "non_aggression": -15, "trade": 5}


def talk(state: dict, actor: str, target: str, message: str, secret: bool, rng, history: list[dict]) -> dict:
    from ..orders.parser import find_countries
    c, oc = state["countries"][actor], state["countries"][target]
    L = oc["leader"]
    tr = L["traits"]
    op = opinion(state, target, actor)
    tru = trust(state, target, actor)
    intent = classify(message)
    ratio = total_power(c) / max(0.01, total_power(oc))
    outcome = {"intent": intent, "accepted": None, "effects": []}
    year = state["meta"]["year"]
    from ..world.scenario import next_id
    if intent in NEED:
        need = NEED[intent] - (10 if secret and intent == "non_aggression" else 0) + (tr["cau"] - 0.5) * 10 - (tru - 50) * 0.2
        if intent == "alliance" and get_ideology(state, c["ideology"])["family"] != get_ideology(state, oc["ideology"])["family"]:
            need += 10
        ok = op >= need and not at_war(state, actor, target)
        if ok and not treaty_between(state, actor, target, (intent,)):
            state["treaties"].append({"id": next_id(state, "t"), "type": intent, "members": [actor, target], "since": year, "secret": secret,
                                      "name": f"{c['adj']}-{oc['adj']} {intent.replace('_', ' ').title()}"})
            add_memory(state, target, actor, "treaty", 15, f"{'Secretly s' if secret else 'S'}igned a {intent.replace('_', ' ')} with {c['name']} in {year}.")
            add_memory(state, actor, target, "treaty", 15, f"Signed a {intent.replace('_', ' ')} with {oc['name']} in {year}.")
            emit(state, "diplomacy", f"{c['name']} and {oc['name']} sign a {intent.replace('_', ' ')}", "" if secret else "Negotiated directly between the two governments.",
                 [actor, target], 3, tags=["treaty"] + (["secret"] if secret else []))
            outcome["effects"].append(f"{intent.replace('_', ' ').title()} signed" + (" (secret)" if secret else ""))
        outcome["accepted"] = ok
        outcome["reason"] = f"opinion {op:+.0f} vs required {need:+.0f}"
    elif intent == "peace":
        ws = [w for w in wars_of(state, actor) if target in w["att"] + w["def"]]
        if ws:
            from ..sim.war import propose_peace
            terms = "annex_occupied" if re.search(r"cede|annex|territor", message.lower()) else "white"
            ok, msg = propose_peace(state, ws[0], actor, terms)
            outcome.update(accepted=ok, reason=msg)
            if ok:
                outcome["effects"].append("Peace concluded")
        else:
            outcome.update(accepted=None, reason="not at war")
    elif intent == "joint_war":
        others = [t for t in find_countries(state, message, exclude=actor) if t != target]
        if others:
            x = others[0]
            ok = opinion(state, target, x) < -15 and op > 20 and tr["agg"] > 0.35
            outcome.update(accepted=ok, reason=f"their view of {state['countries'][x]['name']}: {opinion(state, target, x):+.0f}")
            if ok:
                w = next((w for w in wars_of(state, actor) if x in w["att"] + w["def"]), None)
                if w:
                    from ..sim.war import join_war
                    join_war(state, w, target, "att" if actor in w["att"] else "def")
                    outcome["effects"].append(f"{oc['name']} joins the {w['name']}")
                else:
                    state.setdefault("pledges", []).append({"from": target, "to": actor, "kind": "join_against", "against": x, "year": year})
                    outcome["effects"].append(f"{oc['name']} pledges to join a war against {state['countries'][x]['name']}")
    elif intent in ("subjugation", "union"):
        ok = (intent == "subjugation" and ratio > 4 and op > -30) or (intent == "union" and op > 55 and ratio > 2)
        outcome.update(accepted=ok, reason=f"power ratio {ratio:.1f}, opinion {op:+.0f}")
        if ok:
            from ..orders.executor import _execute
            msg = _execute(state, actor, {"type": "demand_subjugation" if intent == "subjugation" else "annex_peacefully", "target": target}, rng, "diplomacy")
            outcome["effects"].append(msg)
        else:
            modify(state, target, actor, -8)
    elif intent in ("demand", "threat"):
        modify(state, target, actor, -12, -5)
        add_memory(state, target, actor, "threat", -12, f"Threatened by {c['name']} in {year}.")
        outcome.update(accepted=ratio > 3 and tr["agg"] < 0.4, reason=f"power ratio {ratio:.1f}")
        outcome["effects"].append("Relations worsen")
    elif intent == "insult":
        modify(state, target, actor, -10)
        add_memory(state, target, actor, "insult", -10, f"Insulted by {c['name']}'s government in {year}.")
        outcome["effects"].append("Relations worsen")
    elif intent == "aid":
        amt = c["gdp"] * 0.002
        c["treasury"] -= amt
        oc["treasury"] += amt
        modify(state, target, actor, 12, 4)
        add_memory(state, target, actor, "aid", 12, f"Received aid from {c['name']} in {year}.")
        outcome.update(accepted=True)
        outcome["effects"].append("Aid delivered; relations improve")
    elif intent == "promise":
        state.setdefault("pledges", []).append({"from": actor, "to": target, "kind": "no_attack", "year": year})
        modify(state, target, actor, 4, 3)
        outcome["effects"].append(f"{oc['name']} notes our pledge - breaking it later will be remembered as betrayal")
    elif intent == "apology":
        gain = 6 + 8 * tr["hon"]
        modify(state, target, actor, gain, 2)
        outcome["effects"].append("Relations improve slightly")
    else:
        recent = sum(1 for h in history[-6:] if h["role"] == "player")
        if recent < 3:
            modify(state, target, actor, 2)
    op2 = opinion(state, target, actor)
    reply = offline_reply(state, actor, target, intent, outcome, op2)
    persona = (f"You are {L['name']}, {L['title']} of {oc['name']} ({oc['gov']}, {get_ideology(state, oc['ideology'])['name']}), in {year}. "
               f"Personality: aggression {tr['agg']:.1f}, caution {tr['cau']:.1f}, honour {tr['hon']:.1f}, ambition {tr['amb']:.1f}, pragmatism {tr['prag']:.1f}. "
               f"You regard {c['name']} at {op2:+.0f}/100 and trust them {trust(state, target, actor):.0f}/100. Your nation remembers: "
               + "; ".join(f"{m['y']}: {m['text']}" for m in sorted([m for m in oc['memories'] if m['other'] == actor], key=lambda m: -abs(m['w']))[:5])
               + f". Your ambitions: {'; '.join(oc.get('ambitions', [])[:3]) or 'security and prosperity'}. "
               "Stay in character, period-appropriate, 2-5 sentences. The DECISION given is final: do not contradict it or promise anything else.")
    convo = "\n".join(f"{'ENVOY' if h['role'] == 'player' else 'YOU'}: {h['text']}" for h in history[-8:])
    ai = generate("diplomacy", persona, f"{convo}\nENVOY of {c['name']} ({'secret channel' if secret else 'official'}): {message}\nDECISION: {outcome}\nWrite your reply.", 500)
    return {"reply": ai or reply, "outcome": outcome, "opinion": round(op2, 1), "trust": round(trust(state, target, actor), 1), "source": "ai" if ai else "offline",
            "leader": {"name": L["name"], "title": L["title"]}}


def offline_reply(state, actor, target, intent, outcome, op) -> str:
    c, oc = state["countries"][actor], state["countries"][target]
    tr = oc["leader"]["traits"]
    mem = sorted([m for m in oc["memories"] if m["other"] == actor], key=lambda m: -abs(m["w"]))
    if op < -30:
        open_ = "Your envoy is received with icy formality." if tr["hon"] > 0.5 else "Speak quickly. Our patience with your government is thin."
    elif op > 30:
        open_ = f"It is always good to hear from our friends in {c['name']}."
    else:
        open_ = "We have heard your message."
    memory = ""
    if mem:
        m = mem[0]
        if m["w"] < -20:
            memory = f" Do not imagine we have forgotten {m['y']}: {m['text']}"
            memory = memory.rstrip(".") + "."
        elif m["w"] > 10:
            memory = f" We remember {m['y']} with gratitude: {m['text']}".rstrip(".") + "."
    acc = outcome.get("accepted")
    body = {
        "alliance": ("We accept. Our nations will stand together." if acc else "An alliance? Not on these terms, and not while trust between us is so thin."),
        "defensive_pact": ("Agreed: an attack on one shall be answered by both." if acc else "We are not prepared to bind our soldiers to your quarrels."),
        "non_aggression": ("Very well. Neither of us shall raise arms against the other." if acc else "Your assurances are worth little to us."),
        "trade": ("Our merchants will welcome it." if acc else "Our markets are not open to you at present."),
        "peace": ("Enough blood has been spilled. We accept." if acc else "Peace? You will have to offer far more than that."),
        "joint_war": ("Your enemy is our enemy. We are with you." if acc else "We will not be dragged into your wars."),
        "subjugation": ("We have no choice but to accept your protection." if acc else "We would sooner perish than kneel."),
        "union": ("The people have spoken: let our nations become one." if acc else "Our independence is not for sale."),
        "demand": ("We will consider it - under protest." if acc else "Our answer is no. Come and take it, if you dare." if tr["agg"] > 0.5 else "We cannot accept such demands."),
        "threat": ("Threats do not become a great nation." if tr["hon"] > 0.5 else "We will remember this insolence."),
        "insult": ("Such language will be remembered.",), "aid": ("Your generosity will not be forgotten.",),
        "promise": ("We take note of your pledge. History will judge whether it is kept.",), "apology": ("Words are a beginning. Deeds must follow.",),
        "history": ("History weighs heavily between our peoples." if op < 0 else "Our shared history gives us reason for hope.",),
        "intentions": ((("We seek only what is ours by right." if tr["agg"] > 0.5 else "We seek security and prosperity, nothing more.") + (f" Our goals: {'; '.join(oc.get('ambitions', [])[:2])}." if oc.get("ambitions") else "")),),
        "greeting": ("Let us see whether words can serve our peoples better than arms.",),
    }.get(intent, ("We have nothing further to say.",))
    if isinstance(body, tuple):
        body = body[0]
    return f"{open_}{memory} {body}"
