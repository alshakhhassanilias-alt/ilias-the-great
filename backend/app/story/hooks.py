"""Historical momentum: real events scheduled for historical scenarios. They fire only while their
preconditions still hold, so the timeline diverges naturally once history has been changed.
For the player's own country they become decisions; for AI countries they resolve by AI judgement."""
from __future__ import annotations

from ..sim.core import add_memory, alive, build_index, emit, land_power, stab_add
from ..sim.relations import modify
from ..world.geo import get_geo
from .decisions import add_decision


def _alive(state, *tags):
    return all(state["countries"].get(t, {}).get("alive") for t in tags)


def _pids(state, owner, names_codes):
    geo = get_geo()
    out = []
    for pid, p in state["provinces"].items():
        g = geo.provinces.get(pid)
        if g and p["owner"] == owner and ((g["name"], g["country"]) in names_codes or g["country"] in names_codes):
            out.append(pid)
    return out


def hooks_tick(state: dict, rng) -> None:
    y, m = state["meta"]["year"], state["meta"]["month"]
    player = state["meta"].get("player")
    for h in state.get("hooks", []):
        if h["done"] or (y, m) < (h["y"], h["m"]):
            continue
        h["done"] = True
        if (y - h["y"]) > 2:
            continue  # the moment has passed
        fn = HOOKS.get(h["id"])
        if fn:
            fn(state, rng, h, h["tag"] == player)


def _rhineland(state, rng, h, is_player):
    if not _alive(state, "GER", "FRA"):
        return
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"] + " France may react - or may not.",
                     [("march", "March into the Rhineland", "Restore sovereignty over the Rhineland.", [{"type": "national_initiative", "name": "Remilitarisation of the Rhineland", "effects": {"stability": 6, "war_support": 8, "opinion_world": -6}, "years": 0.25, "cost_share": 0.001}]),
                      ("wait", "Wait", "Avoid provoking France for now.", [])], owner="GER")
        return
    g = state["countries"]["GER"]
    if g["leader"]["traits"]["agg"] > 0.5:
        stab_add(g, 5)
        modify(state, "FRA", "GER", -10)
        modify(state, "GBR", "GER", -4)
        emit(state, "historical", "Germany remilitarises the Rhineland", "German battalions marched into the demilitarised Rhineland on 7 March. France, divided and unwilling to act alone, protested but did not resist.", ["GER", "FRA"], 4, tags=["historical"])


def _spain(state, rng, h, is_player):
    if not _alive(state, "ESP"):
        return
    e = state["countries"]["ESP"]
    if e["stability"] > (50 if is_player else 45) or e["ideology"] not in ("social_democracy", "liberal_democracy", "communism"):
        emit(state, "historical", "Spain avoids civil war", "The military plot against the Republic fizzled; the Spanish state holds together.", ["ESP"], 3, tags=["alternate"])
        return
    from ..sim.stability import civil_war
    civil_war(state, "ESP", rng)
    reb = [t for t, c in state["countries"].items() if c["alive"] and "ESP" in c.get("predecessors", []) and c["founded"] == state["meta"]["year"]]
    if reb:
        r = state["countries"][reb[-1]]
        r["name"], r["adj"], r["ideology"], r["gov"] = "Nationalist Spain", "Nationalist Spanish", "fascism", "Military Dictatorship"
        r["leader"]["name"], r["leader"]["title"], r["leader"]["born"] = "Francisco Franco", "Caudillo", 1892
        r["army"] = max(r["army"], e["army"] * 0.8)
        for w in state["wars"]:
            if reb[-1] in w["att"]:
                w["name"] = "Spanish Civil War"
        if _alive(state, "GER") and "GER" != state["meta"].get("player"):
            modify(state, "GER", reb[-1], 40)
        if _alive(state, "ITA") and "ITA" != state["meta"].get("player"):
            modify(state, "ITA", reb[-1], 40)


def _anticomintern(state, rng, h, is_player):
    if not _alive(state, "GER", "JPN"):
        return
    act = [{"type": "create_organization", "name": "Anti-Comintern Pact", "kind": "bloc", "members": ["GER", "JPN"]}]
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("sign", "Sign the pact", "Align with Japan against the Comintern.", act), ("decline", "Decline", "Keep a free hand.", [])], owner="GER")
        return
    if state["meta"].get("player") == "JPN":
        add_decision(state, "hook", h["title"], h["desc"], [("sign", "Sign the pact", "Align with Germany against the Comintern.", act), ("decline", "Decline", "Keep a free hand.", [])], owner="JPN")
        return
    from ..orders.executor import execute_actions
    execute_actions(state, "GER", act, rng, source="history")


def _marco_polo(state, rng, h, is_player):
    if not _alive(state, "JPN", "CHN"):
        return
    from ..sim.war import start_war
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("escalate", "Launch a full-scale invasion of China", "Total war against the Nationalist government.", [{"type": "declare_war", "target": "CHN", "goal": "conquest"}]),
                                                             ("localize", "Contain the incident", "Negotiate a local settlement.", [])], owner="JPN")
        return
    if state["countries"]["JPN"]["leader"]["traits"]["agg"] > 0.5 and not any("JPN" in w["att"] and "CHN" in w["def"] for w in state["wars"]):
        w = start_war(state, "JPN", "CHN", "conquest", name="Second Sino-Japanese War")


def _anschluss(state, rng, h, is_player):
    if not _alive(state, "GER", "AUT"):
        return
    pids = [pid for pid, p in state["provinces"].items() if p["owner"] == "AUT"]
    act = [{"type": "annex_peacefully", "target": "AUT"}]
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("annex", "Proclaim the Anschluss", "Annex Austria; Britain and France will protest.", act), ("wait", "Respect Austrian independence", "For now.", [])], owner="GER")
        return
    g = state["countries"]["GER"]
    if state["meta"].get("player") == "AUT":
        add_decision(state, "hook", "German demands on Austria", "Berlin demands union. Resistance could mean invasion.",
                     [("resist", "Resist and appeal to the powers", "Refuse the union.", [{"type": "improve_relations", "target": "ITA"}]),
                      ("yield", "Accept the Anschluss", "Austria becomes part of Germany - the campaign continues as Germany's subject.", [{"type": "become_subject", "target": "GER"}])], owner="AUT")
        return
    if g["leader"]["traits"]["agg"] > 0.6 and land_power(g) > 4 * land_power(state["countries"]["AUT"]):
        from ..orders.executor import execute_actions
        execute_actions(state, "GER", act, rng, source="history")


def _sudeten(state, rng, h, is_player):
    if not _alive(state, "GER", "CZS"):
        return
    sud = _pids(state, "CZS", {("Karlovarský", "CZE")})
    if not sud:
        return
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("demand", "Demand the Sudetenland", "Britain and France may concede at a conference.", [{"type": "demand_territory", "target": "CZS", "provinces": sud}]),
                                                             ("drop", "Drop the matter", "", [])], owner="GER")
        return
    if state["meta"].get("player") == "CZS":
        add_decision(state, "hook", "The Sudeten Crisis", "Germany demands the Sudetenland; the Western powers urge concession.",
                     [("cede", "Cede the Sudetenland", "Avoid war.", [{"type": "cede_territory", "target": "GER", "provinces": sud}]), ("refuse", "Refuse and mobilise", "Risk war.", [{"type": "set_mobilization", "level": "total"}])], owner="CZS")
        return
    from ..sim.war import transfer_province
    g = state["countries"]["GER"]
    if g["leader"]["traits"]["agg"] > 0.6:
        for p in sud:
            transfer_province(state, p, "GER", "annexation")
        build_index(state)
        add_memory(state, "CZS", "GER", "territory_lost", -45, "The Sudetenland was handed to Germany at Munich over Czechoslovak objections.")
        add_memory(state, "CZS", "FRA", "betrayal", -30, "France abandoned its ally at Munich.")
        emit(state, "historical", "The Munich Agreement", "Britain, France and Italy agreed to Germany's annexation of the Sudetenland. Czechoslovakia, not consulted, was forced to comply.", ["GER", "CZS", "GBR", "FRA"], 4, sud, ["historical"])


def _pact(state, rng, h, is_player):
    if not _alive(state, "GER", "SOV"):
        return
    act = [{"type": "propose_treaty", "target": "SOV", "treaty": "non_aggression", "secret_protocol": True}]
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("sign", "Sign the pact", "Divide Eastern Europe into spheres of influence.", act), ("refuse", "Refuse", "", [])], owner="GER")
        return
    if state["countries"]["GER"]["leader"]["traits"]["agg"] > 0.6:
        from ..world.scenario import next_id
        state["treaties"].append({"id": next_id(state, "t"), "type": "non_aggression", "members": ["GER", "SOV"], "since": state["meta"]["year"], "name": "Molotov-Ribbentrop Pact", "secret": False})
        emit(state, "historical", "The Molotov-Ribbentrop Pact", "Germany and the Soviet Union stunned the world with a non-aggression pact; a secret protocol divided Eastern Europe between them.", ["GER", "SOV"], 4, tags=["historical"])


def _poland(state, rng, h, is_player):
    if not _alive(state, "GER", "POL"):
        return
    from ..sim.war import start_war
    if is_player:
        add_decision(state, "hook", h["title"], h["desc"], [("invade", "Invade Poland", "War - Britain and France are likely to intervene.", [{"type": "declare_war", "target": "POL", "goal": "conquest"}]),
                                                             ("negotiate", "Negotiate over Danzig", "Seek a diplomatic settlement.", [{"type": "improve_relations", "target": "POL"}])], owner="GER")
        return
    if state["countries"]["GER"]["leader"]["traits"]["agg"] > 0.7 and not any("GER" in w["att"] + w["def"] for w in state["wars"]):
        w = start_war(state, "GER", "POL", "conquest")
        from ..sim.war import join_war
        for ally in ("GBR", "FRA"):
            if _alive(state, ally) and ally not in w["att"] + w["def"] and ally != state["meta"].get("player"):
                join_war(state, w, ally, "def")


def _sarajevo(state, rng, h, is_player):
    if not _alive(state, "AUH", "SRB"):
        return
    from ..sim.war import join_war, start_war
    emit(state, "historical", "Assassination in Sarajevo", "Archduke Franz Ferdinand, heir to the Austro-Hungarian throne, and his wife Sophie were shot dead in Sarajevo by a Bosnian Serb nationalist.", ["AUH", "SRB"], 5, tags=["historical"])
    if is_player:
        add_decision(state, "hook", "The July Crisis", "Vienna must decide how to answer Serbia.",
                     [("war", "Declare war on Serbia", "Settle accounts with Belgrade - Russia may mobilise.", [{"type": "declare_war", "target": "SRB", "goal": "subjugate"}]),
                      ("ultimatum", "Demand an investigation", "Pursue a diplomatic settlement.", [{"type": "improve_relations", "target": "RUS"}])], owner="AUH")
        return
    w = start_war(state, "AUH", "SRB", "subjugate")
    cascade(state, w)


def cascade(state: dict, w: dict) -> None:
    """Alliance chains pull great powers in (the mechanism of 1914)."""
    from ..sim.core import allies
    from ..sim.war import join_war
    player = state["meta"].get("player")
    for _ in range(3):
        for side, other in (("att", "def"), ("def", "att")):
            for t in list(w[side]):
                for a in sorted(allies(state, t)):
                    if a in w["att"] or a in w["def"] or a == player:
                        continue
                    if any(x in allies(state, a) for x in w[other]):
                        continue
                    join_war(state, w, a, side)


def _cuba(state, rng, h, is_player):
    if not _alive(state, "SOV", "USA", "CUB"):
        return
    player = state["meta"].get("player")
    if player in ("SOV", "USA"):
        add_decision(state, "hook", h["title"], h["desc"] + " The world holds its breath.",
                     [("deal", "Seek a secret deal", "Missiles leave Cuba; American missiles quietly leave Turkey.", [{"type": "improve_relations", "target": "USA" if player == "SOV" else "SOV"}]),
                      ("firm", "Stand firm", "Risk escalation to war.", [{"type": "declare_war", "target": "USA" if player == "SOV" else "CUB", "goal": "subjugate"}])], owner=player)
        return
    emit(state, "historical", "Cuban Missile Crisis resolved", "After thirteen days on the brink of nuclear war, Khrushchev agreed to withdraw the missiles from Cuba; the US secretly agreed to remove its missiles from Turkey.", ["SOV", "USA", "CUB"], 5, tags=["historical"])
    state["milestones"].append({"y": state["meta"]["year"], "title": "Cuban Missile Crisis", "actors": ["SOV", "USA"], "kind": "crisis"})


HOOKS = {"rhineland": _rhineland, "spanish_civil_war": _spain, "anti_comintern": _anticomintern, "marco_polo": _marco_polo,
         "anschluss": _anschluss, "sudeten": _sudeten, "nazi_soviet": _pact, "invasion_poland": _poland, "sarajevo": _sarajevo,
         "cuban_missiles": _cuba}
