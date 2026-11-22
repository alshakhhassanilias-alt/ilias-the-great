"""Player decisions: pending choices created by the simulation and the story engine."""
from __future__ import annotations

from ..util import clamp


def add_decision(state: dict, kind: str, title: str, body: str, options: list[tuple], data: dict | None = None,
                 owner: str | None = None, code: str | None = None, deadline_years: float = 1.0) -> dict:
    from ..world.scenario import next_id
    d = {"id": next_id(state, "d"), "kind": kind, "title": title, "body": body,
         "options": [{"id": o[0], "label": o[1], "desc": o[2], **({"actions": o[3]} if len(o) > 3 else {})} for o in options],
         "data": data or {}, "owner": owner, "code": code, "year": state["meta"]["year"], "month": state["meta"]["month"],
         "deadline": state["meta"]["year"] + deadline_years}
    state["decisions"].append(d)
    from ..sim.core import emit
    emit(state, "decision", title, body, [owner] if owner else [], 4 if kind in ("hook", "secession", "succession", "ultimatum") else 3, tags=["decision"], data={"decision": d["id"]})
    return d


def resolve_decision(state: dict, did: str, option: str, rng, auto: bool = False) -> dict:
    from ..sim.core import add_memory, build_index, emit, stab_add
    from ..sim.relations import modify
    d = next((x for x in state["decisions"] if x["id"] == did), None)
    if not d:
        return {"ok": False, "error": "No such decision"}
    opt = next((o for o in d["options"] if o["id"] == option), None)
    if not opt:
        return {"ok": False, "error": "Invalid option"}
    state["decisions"].remove(d)
    k = d["kind"]
    data = d["data"]
    owner = d.get("owner")
    c = state["countries"].get(owner) if owner else None
    msg = opt["label"]
    if k == "secession":
        from ..sim.successors import create_country
        from ..sim.war import start_war
        pids = [p for p in data["pids"] if state["provinces"][p]["owner"] == owner]
        if not pids:
            return {"ok": True, "message": "The crisis resolved itself."}
        if option == "crush":
            new = create_country(state, pids, parent=owner, kind="independence", rng=rng)
            start_war(state, new, owner, "independence", call_allies=False)
            msg = f"War against the rebels of {state['countries'][new]['name']}."
        elif option == "autonomy":
            for p in pids:
                state["provinces"][p]["autonomy"] = 1
                state["provinces"][p]["unrest"] = clamp(state["provinces"][p]["unrest"] - 35, 0, 100)
            stab_add(c, -2)
            emit(state, "reform", f"Autonomy granted", f"{c['name']} grants self-government to the rebellious provinces.", [owner], 3, pids[:6])
        else:
            new = create_country(state, pids, parent=owner, kind="grant", rng=rng)
            add_memory(state, new, owner, "cooperation", 20, f"{c['name']} recognised its independence peacefully.")
            emit(state, "independence", f"{state['countries'][new]['name']} becomes independent", f"{c['name']} peacefully recognised the independence of {state['countries'][new]['name']}.", [owner, new], 4, pids[:6])
    elif k == "succession":
        from ..sim.stability import change_government
        from ..story.threads import close_thread
        if option == "heir":
            stab_add(c, -4)
            close_thread(state, data["thread"], "The established heir prevailed.")
        elif option == "council":
            c["legitimacy"] = clamp(c["legitimacy"] + 12, 0, 100)
            c["policies"]["succession_law"] = "council"
            close_thread(state, data["thread"], "A council of the realm settled the succession and gained lasting influence.")
        else:
            change_government(state, owner, "liberal_democracy", rng, reason="reform", gov="Republic")
            c["leader"]["title"] = "President"
            close_thread(state, data["thread"], "The monarchy was abolished.")
    elif k == "peace_offer":
        from ..sim.war import apply_peace, end_war
        w = next((x for x in state["wars"] if x["id"] == data["war"]), None)
        if w and option == "accept_occupied":
            apply_peace(state, w, owner, data["from"], "annex_occupied")
        elif w and option == "white":
            end_war(state, w, "none", f"A white peace ended the {w['name']}.")
    elif k == "alliance_offer":
        if option == "accept":
            from ..world.scenario import next_id
            state["treaties"].append({"id": next_id(state, "t"), "type": "defensive_pact", "members": [owner, data["from"]], "since": state["meta"]["year"],
                                      "name": f"{c['adj']}-{state['countries'][data['from']]['adj']} Defensive Pact", "secret": False})
            add_memory(state, data["from"], owner, "treaty", 20, f"Signed a defensive pact with {c['name']}.")
            emit(state, "diplomacy", f"Defensive pact with {state['countries'][data['from']]['name']}", "The pact is signed.", [owner, data["from"]], 3)
        else:
            modify(state, data["from"], owner, -8)
    elif k == "ultimatum":
        from ..sim.war import start_war, transfer_province
        frm = data["from"]
        if option == "cede":
            for p in data["provinces"]:
                if state["provinces"][p]["owner"] == owner:
                    transfer_province(state, p, frm, "annexation")
            build_index(state)
            stab_add(c, -10)
            add_memory(state, owner, frm, "territory_lost", -40, f"Forced to cede territory to {state['countries'][frm]['name']} under threat of war.")
            emit(state, "diplomacy", f"{c['name']} yields to {state['countries'][frm]['name']}", "Territory has been ceded under duress.", [owner, frm], 4, data["provinces"][:6])
        else:
            start_war(state, frm, owner, "conquest")
    elif k in ("hook", "event", "story"):
        from ..orders.executor import execute_actions
        res = execute_actions(state, owner, opt.get("actions", []), rng, source="decision")
        msg = res.get("summary", msg)
    if not auto:
        emit(state, "decision_made", f"Decision: {d['title']}", f"{c['name'] if c else 'The government'} chose: {opt['label']}.", [owner] if owner else [], 2, tags=["decision"])
    build_index(state)
    return {"ok": True, "message": msg}


def expire_decisions(state: dict, rng) -> None:
    year = state["meta"]["year"] + (state["meta"]["month"] - 1) / 12
    for d in list(state["decisions"]):
        if d["deadline"] <= year:
            default = d["options"][-1]["id"] if d["kind"] != "secession" else "crush"
            resolve_decision(state, d["id"], default, rng, auto=True)
