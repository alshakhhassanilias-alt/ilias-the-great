"""Leaders: ageing, death, elections, dynastic succession and succession crises."""
from __future__ import annotations

import math

from ..util import clamp
from ..world.factory import make_leader, random_traits
from ..world.ideologies import get_ideology
from .core import emit, stab_add

LONGEVITY = {"gene_therapy": 6, "human_enhancement": 20, "synthetic_bodies": 120, "digital_consciousness": 60}


def leaders_tick(state: dict, dt: float, rng) -> None:
    year = state["meta"]["year"]
    player = state["meta"].get("player")
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        L = c["leader"]
        bonus = sum(v for k, v in LONGEVITY.items() if k in c["techs"])
        age = year - L["born"] - bonus
        if L.get("digital"):
            p_death = 0.002 * dt
        else:
            p_death = min(0.9, 0.0015 * math.exp((age - 40) / 9.5)) * dt
        fam = get_ideology(state, c["ideology"])["family"]
        elective = c["policies"].get("succession") != "hereditary" and fam in ("democratic", "transhumanist", "post-national", "technocratic")
        if rng.random() < p_death:
            succession(state, t, rng, cause="death")
            continue
        if elective and year - L["since"] >= 4 and rng.random() < 0.3 * dt * (year - L["since"]) / 4:
            election(state, t, rng)


def succession(state: dict, tag: str, rng, cause: str = "death") -> None:
    c = state["countries"][tag]
    old = c["leader"]
    year = state["meta"]["year"]
    hereditary = c["policies"].get("succession") == "hereditary"
    culture = old.get("culture") or c["culture"]
    if hereditary:
        heir = make_leader(rng, culture, year, old["title"], born=year - rng.randint(18, 45))
        surname = old["name"].split()[-1] if " " in old["name"] else old["name"]
        heir["name"] = heir["name"].split()[0] + " " + surname
        heir["traits"] = {k: clamp((v + rng.gauss(0.45, 0.2)) / 2, 0, 1) for k, v in old["traits"].items()}
        crisis_p = 0.12 if c["policies"].get("succession_law") else 0.3
        c["leader"] = heir
        dynasty = c.setdefault("dynasty", {"name": surname, "founded": year, "rulers": 1})
        dynasty["rulers"] = dynasty.get("rulers", 1) + 1
        if rng.random() < crisis_p and c["pop"] > 2:
            from ..story.threads import open_thread
            claimant = make_leader(rng, culture, year, "Pretender")
            th = open_thread(state, "succession", f"{c['adj']} Succession Crisis",
                             f"The death of {old['name']} in {year} left the succession contested between {heir['name']} and {claimant['name']}.",
                             [tag], key=f"succession:{tag}", tension=60, data={"claimant": claimant["name"], "heir": heir["name"]})
            stab_add(c, -12)
            emit(state, "succession", f"Succession crisis in {c['name']}", f"{old['name']} has died. {heir['name']} claims the throne, but {claimant['name']} disputes the succession and factions of the court and army are choosing sides.",
                 [tag], 4, tags=["succession"], thread=th["id"])
            if tag == state["meta"].get("player"):
                from ..story.decisions import add_decision
                add_decision(state, "succession", f"The {c['adj']} Succession",
                             f"{heir['name']} and {claimant['name']} both claim the throne of {c['name']}.",
                             [("heir", f"Support {heir['name']}", "Uphold the established line. Some stability loss; the pretender's faction is purged."),
                              ("council", "Convene a council of the realm", "Let an assembly decide; legitimacy rises, power is shared."),
                              ("abolish", "Abolish the monarchy", "End hereditary rule and proclaim a republic.")],
                             data={"thread": th["id"], "claimant": claimant["name"]}, owner=tag)
            return
        emit(state, "succession", f"{heir['name']} succeeds {old['name']}", f"{old['name']} of {c['name']} has {'died' if cause == 'death' else 'abdicated'}. {heir['name']} succeeds as {heir['title']}.",
             [tag], 3 if c["pop"] > 20 or tag == state["meta"].get("player") else 2, tags=["leader"])
    else:
        new = make_leader(rng, culture, year, old["title"], digital=old.get("digital", False))
        ide = get_ideology(state, c["ideology"])
        if ide["family"] in ("authoritarian", "socialist"):
            new["traits"] = {k: clamp((v + rng.gauss(0.5, 0.2)) / 2, 0, 1) for k, v in old["traits"].items()}
        c["leader"] = new
        stab_add(c, -3 if cause == "death" else 0)
        emit(state, "leader", f"New leader in {c['name']}: {new['name']}",
             f"{old['name']} has {'died in office' if cause == 'death' else 'left office'}. {new['name']} becomes {new['title']} of {c['name']}.",
             [tag], 3 if c["pop"] > 20 or tag == state["meta"].get("player") else 2, tags=["leader"])


def election(state: dict, tag: str, rng) -> None:
    c = state["countries"][tag]
    old = c["leader"]
    year = state["meta"]["year"]
    incumbent_wins = rng.random() < 0.25 + c["stability"] / 200 and year - old["since"] < 9
    if incumbent_wins:
        old["since"] = year - 0  # new term
        old["term_start"] = year
        emit(state, "election", f"{old['name']} re-elected in {c['name']}", f"Voters in {c['name']} returned {old['name']} for another term.", [tag], 2, tags=["election"])
        old["since"] = year - 1
        return
    new = make_leader(rng, c["culture"] if c["home"] == "earth" else c["home"], year, old["title"])
    new["traits"] = random_traits(rng)
    c["leader"] = new
    swing = None
    if c["ideology"] in ("liberal_democracy", "social_democracy", "conservatism") and rng.random() < 0.4:
        swing = rng.choice([i for i in ("liberal_democracy", "social_democracy", "conservatism") if i != c["ideology"]])
        c["ideology"] = swing
    emit(state, "election", f"Elections in {c['name']}: {new['name']} wins",
         f"{new['name']} defeats {old['name']} to become {new['title']} of {c['name']}." + (f" The new government is broadly {get_ideology(state, swing)['name']}." if swing else ""),
         [tag], 3 if tag == state["meta"].get("player") else 2, tags=["election"])
