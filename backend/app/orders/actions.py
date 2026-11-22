"""Structured action schema shared by the offline parser, AI providers and decision events.
Every action is validated and assessed for feasibility before anything touches the world state."""
from __future__ import annotations

from ..util import clamp, fmt_money
from ..world.geo import BODIES, get_geo
from ..world.ideologies import BASE, get_ideology
from ..world.techtree import all_techs
from ..sim.economy import base_cost, years_for
from ..sim.core import allies, at_war, idx, land_power, naval_power, total_power, treaty_between
from ..sim.relations import opinion

ACTION_TYPES = {
    "declare_war": "Declare war on a country (goal: conquest|subjugate|liberation)",
    "make_peace": "Seek peace with an enemy (terms: white|annex_occupied|puppet|surrender)",
    "propose_treaty": "Propose a treaty (treaty: alliance|defensive_pact|non_aggression|trade)",
    "break_treaty": "Cancel treaties with a country",
    "improve_relations": "Diplomatic outreach to improve relations",
    "threaten": "Threaten a country",
    "send_aid": "Send economic aid (share of our GDP)",
    "sanction": "Impose sanctions",
    "demand_territory": "Demand provinces from a country under threat of war",
    "cede_territory": "Cede provinces to a country",
    "annex_peacefully": "Peacefully annex a subject or willing state",
    "demand_subjugation": "Demand that a weaker state become our subject",
    "release_subject": "Release a subject state",
    "become_subject": "Accept another state's overlordship",
    "grant_independence": "Grant independence to provinces / a region / an off-world colony",
    "dismantle_empire": "Deliberately dismantle the state into successor states (mode: dismantle|decentralize|collapse)",
    "reunify": "Attempt to reunify the lands of a former state",
    "create_organization": "Create an international organisation (kind: alliance|federation|economic|international|bloc)",
    "join_organization": "Join an organisation", "leave_organization": "Leave an organisation",
    "set_budget": "Set a budget share (category: military|research|infra|welfare, value 0-0.5)",
    "set_policy": "Set a policy (integration, economy, digital_rights, ai_rights, upload, enhancement, colonial, mobilization)",
    "set_military_mix": "Set the balance of army/navy/air/space spending",
    "research": "Direct research toward a technology or category",
    "change_government": "Change the form of government / ideology",
    "create_ideology": "Invent a new ideology (optionally adopt it)",
    "pass_law": "Enact a law with validated effects",
    "national_initiative": "Start a national programme with cost, duration and validated effects",
    "colonize": "Found a settlement on another world (region or body)",
    "megaproject": "Start a megaproject (terraform|mass_upload|dyson_swarm|space_elevator|interstellar_expedition)",
    "rename_country": "Rename the state", "move_capital": "Move the capital",
    "espionage": "Covert operation (op: investigate|steal_tech|sabotage|incite|coup)",
    "found_religion": "Found a new religion or civic faith",
    "set_mobilization": "Set mobilisation level (none|partial|total)",
    "strategic_goal": "A long-term strategic objective turned into a mission",
    "switch_country": "Play as another country",
}

CATS = {"military", "research", "infra", "welfare"}
POLICIES = {"integration": ["assimilate", "autonomy", "suppress", "federal"], "economy": ["market", "mixed", "planned", "autarky", "post_scarcity"],
            "digital_rights": ["none", "limited", "equal"], "ai_rights": ["none", "limited", "equal", "banned"],
            "upload": ["banned", "voluntary", "encouraged", "mass"], "enhancement": ["banned", "regulated", "free", "mandatory"],
            "colonial": ["direct", "autonomy", "representation"], "mobilization": ["none", "partial", "total"],
            "succession": ["hereditary", "elective"], "auto_research": [True, False]}
MEGA = {
    "terraform": ("Terraforming of {b}", "terraforming", 2500, 40, {"terraform": 0.1}),
    "mass_upload": ("The Great Upload", "digital_consciousness", 400, 10, {"dig_share": 0.35, "stability": -10}),
    "dyson_swarm": ("Dyson Swarm Construction", "artificial_habitats", 20000, 60, {"prod": 0.3}),
    "space_elevator": ("Space Elevator", "orbital_infrastructure", 300, 12, {"prod": 0.05}),
    "interstellar_expedition": ("Interstellar Colony Fleet", "interstellar_colonization", 6000, 50, {}),
}


def _country(state, tag):
    c = state["countries"].get(tag)
    return c if c and c["alive"] else None


def assess(state: dict, actor: str, a: dict) -> dict:
    """Return an assessment: ok, feasibility, cost (billions), years, explanation, consequences."""
    c = state["countries"][actor]
    t = a.get("type")
    res = {"ok": True, "feasibility": "feasible", "cost": 0.0, "years": 0.0, "explanation": "", "consequences": []}

    def no(msg, alt=None):
        res.update(ok=False, feasibility="impossible", explanation=msg)
        if alt:
            res["alternative"] = alt
        return res
    if t not in ACTION_TYPES and t != "narrative":
        return no(f"Unknown action type '{t}'.")
    tgt = a.get("target")
    if t in ("declare_war", "make_peace", "propose_treaty", "break_treaty", "improve_relations", "threaten", "send_aid", "sanction",
             "demand_territory", "cede_territory", "annex_peacefully", "demand_subjugation", "release_subject", "become_subject", "espionage"):
        oc = _country(state, tgt)
        if not oc:
            return no("That country does not exist (or no longer exists).")
        if tgt == actor and not (t == "espionage" and a.get("op", "investigate") == "investigate"):
            return no("A state cannot do that to itself.")
    if t == "declare_war":
        if at_war(state, actor, tgt):
            return no(f"We are already at war with {oc['name']}.")
        mine = land_power(c) + sum(land_power(state["countries"][x]) for x in sorted(allies(state, actor))) * 0.5
        theirs = land_power(oc) * 1.1 + sum(land_power(state["countries"][x]) for x in sorted(allies(state, tgt)) if x != actor)
        ratio = mine / max(0.01, theirs)
        joiners = [state["countries"][x]["name"] for x in sorted(allies(state, tgt)) if x != actor][:6]
        reach = any(state["provinces"].get(nb, {}).get("ctrl") == tgt for pid in idx(state)["owned"].get(actor, []) for nb in get_geo().neighbors(pid)) if True else False
        res["explanation"] = (f"Estimated balance of land power {ratio:.2f}:1 in our favour." if ratio >= 1 else f"The enemy coalition is stronger ({1 / ratio:.2f}:1 against us).")
        if not reach:
            nav = naval_power(c) / max(0.01, naval_power(oc))
            res["explanation"] += f" We share no land border; invasion depends on naval superiority ({nav:.2f}:1)."
        if joiners:
            res["consequences"].append(f"Their allies will likely join: {', '.join(joiners)}.")
        if treaty_between(state, actor, tgt, ("non_aggression", "alliance", "defensive_pact")):
            res["consequences"].append("We have a treaty with them: breaking it is a betrayal the world will remember.")
        res["consequences"].append("Occupied provinces will resist; conquest adds unrest and integration work.")
        if ratio < 0.7:
            res["feasibility"] = "risky"
        res["years"] = round(clamp(2 / max(0.2, ratio - 0.5), 0.3, 10), 1)
    elif t == "make_peace":
        if not at_war(state, actor, tgt):
            return no(f"We are not at war with {oc['name']}.")
    elif t == "propose_treaty":
        tr = a.get("treaty", "alliance")
        if tr not in ("alliance", "defensive_pact", "non_aggression", "trade"):
            return no("Unknown treaty type.")
        if treaty_between(state, actor, tgt, (tr,)):
            return no("That treaty already exists.")
        op = opinion(state, tgt, actor)
        need = {"alliance": 35, "defensive_pact": 20, "non_aggression": -20, "trade": 5}[tr]
        res["explanation"] = f"{oc['name']} regards us at {op:+.0f}; they would want at least {need:+d} for a {tr.replace('_', ' ')}."
        if op < need - 25:
            res["feasibility"] = "unlikely"
    elif t in ("demand_territory", "cede_territory"):
        ps = [p for p in a.get("provinces", []) if p in state["provinces"]]
        owner = tgt if t == "demand_territory" else actor
        ps = [p for p in ps if state["provinces"][p]["owner"] == owner]
        if not ps:
            return no("None of those provinces belong to the right country.")
        a["provinces"] = ps
        if t == "demand_territory":
            ratio = total_power(c) / max(0.01, total_power(oc) + sum(total_power(state["countries"][x]) for x in sorted(allies(state, tgt))))
            res["explanation"] = f"Our power relative to them and their allies: {ratio:.2f}:1."
            res["feasibility"] = "likely" if ratio > 2 else "unlikely"
    elif t == "annex_peacefully":
        subject = oc.get("overlord") == actor
        op = opinion(state, tgt, actor)
        ratio = total_power(c) / max(0.01, total_power(oc))
        if not subject and not (op > 50 and ratio > 3) and not (ratio > 6 and not allies(state, tgt) - {actor}):
            res["feasibility"] = "unlikely"
            res["explanation"] = f"{oc['name']} is not our subject and would resist (opinion {op:+.0f}, power ratio {ratio:.1f})."
    elif t in ("set_budget",):
        cat = a.get("category")
        if cat not in CATS:
            return no("Budget category must be military, research, infra or welfare.")
        v = float(a.get("value", 0))
        if v > 0.5:
            return no("No state can sustainably devote more than 50% of GDP to a single budget line.")
        a["value"] = clamp(v, 0, 0.5)
        total = sum(c["budget"].get(k, 0) for k in CATS if k != cat) + a["value"]
        res["explanation"] = f"Total programmed spending would be {total * 100:.1f}% of GDP (sustainable revenue is about 12%)."
        if total > 0.2:
            res["consequences"].append(f"Annual deficit of about {fmt_money((total - 0.12) * c['gdp'])}; debt will accumulate and eventually hurt stability and growth.")
            res["feasibility"] = "costly"
        if cat == "research" and a["value"] >= 0.1:
            res["consequences"].append("Research output will rise sharply; other priorities will be squeezed.")
    elif t == "set_policy":
        pol, val = a.get("policy"), a.get("value")
        if pol not in POLICIES or val not in POLICIES[pol]:
            return no(f"Invalid policy setting {pol}={val}.")
        if pol in ("upload",) and "upload" not in c["mods"].get("unlocks", []):
            return no("Mind uploading has not been invented yet.", {"type": "research", "tech": "digital_consciousness"})
    elif t == "research":
        at = all_techs(state)
        tech = a.get("tech")
        if tech:
            if tech not in at:
                return no("Unknown technology.")
            if tech in c["techs"]:
                return no(f"We already have {at[tech]['name']}.")
            path = research_path(state, c, tech)
            cost = sum(base_cost(at[x]["tier"]) for x in path)
            rp = max(1e-6, c.get("rp_rate", 0.01))
            res["years"] = round(years_for(cost, rp), 1)
            res["explanation"] = f"{at[tech]['name']} requires {len(path)} breakthrough(s): {', '.join(at[x]['name'] for x in path[:6])}{'...' if len(path) > 6 else ''}. At current funding and growth: about {res['years']:.0f} years."
            if res["years"] > 60:
                res["feasibility"] = "long-term"
                res["consequences"].append("Raising research spending would shorten this considerably.")
        elif a.get("category") not in ("industry", "military", "computing", "energy", "biology", "space", "society"):
            return no("Specify a technology or a category.")
    elif t == "colonize":
        body = a.get("body")
        region = a.get("region")
        if region and region in state["provinces"]:
            body = state["provinces"][region]["body"]
        if body not in BODIES:
            return no("Unknown world.")
        req = BODIES[body]["requires"]
        if req not in c["techs"]:
            path = research_path(state, c, req)
            rp = max(1e-6, c.get("rp_rate", 0.01))
            cost = sum(base_cost(all_techs(state)[x]["tier"]) for x in path)
            yrs = years_for(cost, rp)
            return no(f"Settling {BODIES[body]['name']} requires {all_techs(state)[req]['name']}, which is {len(path)} breakthroughs away (about {yrs:.0f} years at the current pace of research). We can begin a research programme toward it instead.",
                      {"type": "research", "tech": req})
        from ..sim.space import colony_cost, free_regions
        if body not in state["bodies"]:
            from ..sim.space import unlock_body
            unlock_body(state, body, actor)
        targeted = {pr["target"] for x in state["countries"].values() for pr in x["projects"] if pr["kind"] == "colonize"}
        free_all = free_regions(state, body)
        free = [p for p in free_all if p not in targeted]
        if region and region not in free:
            return no("That region is already claimed or another expedition is already on its way there.")
        if not free:
            return no(f"Every region of {BODIES[body]['name']} has already been claimed" + (" or is the target of another expedition." if free_all else "."))
        cost, years = colony_cost(state, body, c)
        res.update(cost=cost, years=years, explanation=f"A settlement on {BODIES[body]['name']} will cost about {fmt_money(cost)} over {years:.0f} years.")
        a["region"] = region or free[0]
    elif t == "megaproject":
        kind = a.get("kind")
        if kind not in MEGA:
            return no("Unknown megaproject.")
        name, req, cost, years, eff = MEGA[kind]
        if req not in c["techs"]:
            return no(f"This requires {all_techs(state)[req]['name']}, which we have not mastered.", {"type": "research", "tech": req})
        if kind == "terraform":
            b = a.get("body", "mars")
            if not any(p["owner"] == actor and p["body"] == b for p in state["provinces"].values()):
                return no("We need settlements on that world before terraforming it.")
        res.update(cost=cost, years=years, explanation=f"{name.format(b=a.get('body', 'Mars').title())}: about {fmt_money(cost)} over {years} years.")
        if kind == "mass_upload":
            res["consequences"].append("Biological population will fall as citizens upload; bio-conservatives will resist; some regions may secede.")
    elif t == "change_government":
        ide = a.get("ideology")
        if ide and ide not in state["ideologies"] and ide not in BASE:
            return no("Unknown ideology.")
        if ide == "planetarism" or "planetary" in (a.get("gov") or "").lower():
            from ..story.director import detect_phase
            ph = detect_phase(state, actor)
            if ph["metrics"].get("prov_share", 0) < 0.5:
                res["feasibility"] = "symbolic"
                res["explanation"] = "We do not govern most of the planet; the planetary government would be a claim rather than a reality."
        res["consequences"].append("Regime change costs stability in the short term.")
    elif t == "dismantle_empire":
        n = len(idx(state)["owned"].get(actor, []))
        if n < 2:
            return no("There is nothing left to dismantle.")
        res["explanation"] = "The state will be divided into successor states along historical and geographical lines."
        res["consequences"].append("This is irreversible. Successor states will have their own leaders, ideologies and ambitions.")
    elif t == "grant_independence":
        ps = [p for p in a.get("provinces", []) if state["provinces"].get(p, {}).get("owner") == actor]
        if not ps:
            return no("We do not own any of those territories.")
        if len(ps) >= len(idx(state)["owned"].get(actor, [])):
            return no("That would leave nothing of the state; use 'dismantle the empire' instead.")
        a["provinces"] = ps
    elif t == "national_initiative":
        cs = clamp(float(a.get("cost_share", 0.01)), 0, 0.2)
        yrs = clamp(float(a.get("years", 3)), 0.25, 50)
        a["cost_share"], a["years"] = cs, yrs
        res.update(cost=cs * c["gdp"] * yrs, years=yrs, explanation=f"{a.get('name', 'Programme')}: about {fmt_money(cs * c['gdp'])} per year for {yrs:g} years.")
    elif t == "espionage":
        op = a.get("op", "investigate")
        if op not in ("investigate", "steal_tech", "sabotage", "incite", "coup"):
            return no("Unknown covert operation.")
        res.update(cost=c["gdp"] * 0.001, explanation=f"Success depends on the relative strength of our intelligence services and {oc['name']}'s stability ({oc['stability']:.0f}%).")
        if op == "coup":
            res["consequences"].append("If exposed, the operation will be remembered as interference for generations.")
    elif t == "create_organization":
        if not a.get("name"):
            a["name"] = "New Concord"
        a["members"] = [m for m in a.get("members", []) if _country(state, m) and m != actor][:40]
    elif t == "rename_country":
        if not a.get("name") or len(a["name"]) > 60:
            return no("Provide a new name.")
    elif t == "move_capital":
        if state["provinces"].get(a.get("province"), {}).get("owner") != actor:
            return no("We do not own that province.")
    return res


def research_path(state: dict, c: dict, tech: str) -> list[str]:
    at = all_techs(state)
    known = set(c["techs"])
    order: list[str] = []

    def visit(t):
        if t in known or t in order or t not in at:
            return
        for p in at[t]["pre"]:
            visit(p)
        order.append(t)
    visit(tech)
    return order
