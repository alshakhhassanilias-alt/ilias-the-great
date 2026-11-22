"""Executes validated structured actions against the authoritative world state."""
from __future__ import annotations

from ..util import clamp, fmt_money
from ..world.geo import BODIES, get_geo
from ..world.ideologies import get_ideology, invent_ideology
from ..world.techtree import all_techs
from ..sim.core import add_memory, allies, at_war, build_index, emit, idx, stab_add, total_power, treaty_between
from ..sim.relations import modify, opinion
from .actions import MEGA, assess, research_path

LAW_KEYWORDS = [
    (("artificial", "ai ", "machine", "synthetic mind", "artificial consciousness"), {"policy": ("ai_rights", "equal")}),
    (("upload", "digital", "emulated", "virtual citizen"), {"policy": ("digital_rights", "equal")}),
    (("succession", "dynast", "heir", "throne"), {"law_kind": "succession", "eff": {"stab": 2}}),
    (("planetary", "world constitution", "global constitution"), {"eff": {"stab": 3}}),
    (("education", "school", "universit"), {"eff": {"research": 0.05}}),
    (("labor", "labour", "worker", "wage"), {"eff": {"stab": 2, "prod": -0.01}}),
    (("tax", "tariff"), {"eff": {"prod": 0.02}}),
    (("free speech", "liberty", "rights", "freedom"), {"eff": {"stab": 1}}),
    (("enhancement", "augment", "gene"), {"policy": ("enhancement", "free")}),
    (("environment", "climate", "ecolog"), {"eff": {"stab": 1, "prod": -0.01}}),
    (("admin", "bureaucra", "civil service", "governance code"), {"eff": {"prod": 0.02, "stab": 2}}),
]


def execute_actions(state: dict, actor: str, actions: list[dict], rng, source: str = "player", text: str | None = None) -> dict:
    results = []
    for a in actions or []:
        a = dict(a)
        r = assess(state, actor, a)
        if not r["ok"]:
            alt = r.get("alternative")
            if alt and source == "player":
                r2 = assess(state, actor, alt)
                if r2["ok"]:
                    msg = _execute(state, actor, alt, rng, source)
                    results.append({"action": a, "ok": True, "converted": alt, "message": f"{r['explanation']} -> {msg}"})
                    continue
            results.append({"action": a, "ok": False, "message": r["explanation"]})
            continue
        try:
            msg = _execute(state, actor, a, rng, source)
            results.append({"action": a, "ok": True, "message": msg})
        except Exception as e:  # never let a malformed action corrupt the world
            results.append({"action": a, "ok": False, "message": f"Could not execute: {e}"})
    build_index(state)
    ok = [r for r in results if r["ok"]]
    summary = " ".join(r["message"] for r in results if r.get("message"))
    if source == "player" and text and ok:
        c = state["countries"][actor]
        emit(state, "order", f"{c['name']}: {text[:80]}", f"{c['leader']['name']} ordered: “{text}”. {summary}", [actor], 2, tags=["order", "player"],
             data={"text": text})
    return {"results": results, "summary": summary, "ok": bool(ok)}


def _accepts(state, target, actor, need, rng) -> bool:
    if state["meta"].get("player") == target:
        return False
    return opinion(state, target, actor) + rng.uniform(-10, 10) >= need


def _execute(state: dict, actor: str, a: dict, rng, source: str) -> str:
    from ..world.scenario import next_id
    c = state["countries"][actor]
    t = a["type"]
    tgt = a.get("target")
    oc = state["countries"].get(tgt) if tgt else None
    year = state["meta"]["year"]
    if t == "declare_war":
        from ..sim.war import start_war
        w = start_war(state, actor, tgt, a.get("goal", "conquest"), targets=[p for p in a.get("targets", []) if p in state["provinces"]] or None)
        if a.get("terms"):
            w["terms"] = a["terms"]
        from ..sim.war import join_war
        for pl in list(state.get("pledges", [])):
            if pl["kind"] == "join_against" and pl["to"] == actor and pl["against"] == tgt and state["countries"].get(pl["from"], {}).get("alive"):
                join_war(state, w, pl["from"], "att")
                state["pledges"].remove(pl)
        side = [state["countries"][x]["name"] for x in w["def"] if x != tgt]
        return f"War declared on {oc['name']}" + (f"; {', '.join(side)} joined them." if side else ".")
    if t == "make_peace":
        from ..sim.war import propose_peace
        w = next(w for w in state["wars"] if (actor in w["att"] and tgt in w["def"]) or (actor in w["def"] and tgt in w["att"]))
        ok, msg = propose_peace(state, w, actor, a.get("terms", "white"))
        return msg
    if t == "propose_treaty":
        tr = a.get("treaty", "alliance")
        need = {"alliance": 35, "defensive_pact": 20, "non_aggression": -20, "trade": 5}[tr]
        if a.get("secret_protocol"):
            need -= 15
        if not _accepts(state, tgt, actor, need, rng):
            modify(state, tgt, actor, -2)
            return f"{oc['name']} declined the {tr.replace('_', ' ')} (their opinion of us: {opinion(state, tgt, actor):+.0f})."
        state["treaties"].append({"id": next_id(state, "t"), "type": tr, "members": [actor, tgt], "since": year,
                                  "name": a.get("name") or f"{c['adj']}-{oc['adj']} {tr.replace('_', ' ').title()}", "secret": bool(a.get("secret"))})
        add_memory(state, tgt, actor, "treaty", 15, f"Signed a {tr.replace('_', ' ')} with {c['name']} in {year}.")
        add_memory(state, actor, tgt, "treaty", 15, f"Signed a {tr.replace('_', ' ')} with {oc['name']} in {year}.")
        if not a.get("secret"):
            emit(state, "diplomacy", f"{c['name']} and {oc['name']} sign a {tr.replace('_', ' ')}", f"The {c['adj']}-{oc['adj']} {tr.replace('_', ' ')} was signed in {year}.", [actor, tgt], 3, tags=["treaty"])
        return f"{oc['name']} agreed to the {tr.replace('_', ' ')}."
    if t == "break_treaty":
        n = 0
        for tr in list(state["treaties"]):
            if actor in tr["members"] and tgt in tr["members"] and (not a.get("treaty") or tr["type"] == a["treaty"]):
                state["treaties"].remove(tr)
                n += 1
        if n:
            add_memory(state, tgt, actor, "betrayal", -25, f"{c['name']} broke its treaty with us in {year}.")
            emit(state, "diplomacy", f"{c['name']} renounces its treaties with {oc['name']}", "", [actor, tgt], 3)
        return f"{n} treaty(ies) with {oc['name']} cancelled."
    if t == "improve_relations":
        gain = 12 * (0.6 + c["leader"]["traits"]["hon"] * 0.6)
        modify(state, tgt, actor, gain, 3)
        c["treasury"] -= c["gdp"] * 0.0005
        return f"Diplomatic outreach to {oc['name']}: relations improve (+{gain:.0f})."
    if t == "threaten":
        modify(state, tgt, actor, -15, -5)
        add_memory(state, tgt, actor, "threat", -12, f"Threatened by {c['name']} in {year}.")
        return f"{oc['name']} has been warned. They will remember it."
    if t == "send_aid":
        share = clamp(float(a.get("share", 0.005)), 0.0005, 0.05)
        amt = c["gdp"] * share
        c["treasury"] -= amt
        oc["treasury"] += amt
        modify(state, tgt, actor, 20, 5)
        add_memory(state, tgt, actor, "aid", 15, f"Received {fmt_money(amt)} in aid from {c['name']} in {year}.")
        return f"Sent {fmt_money(amt)} in aid to {oc['name']}."
    if t == "sanction":
        for tr in list(state["treaties"]):
            if tr["type"] == "trade" and actor in tr["members"] and tgt in tr["members"]:
                state["treaties"].remove(tr)
        modify(state, tgt, actor, -20)
        oc.setdefault("temp_mods", []).append({"until": year + 3, "stability": -3})
        add_memory(state, tgt, actor, "interference", -15, f"Sanctioned by {c['name']} in {year}.")
        emit(state, "diplomacy", f"{c['name']} imposes sanctions on {oc['name']}", "", [actor, tgt], 3)
        return f"Sanctions imposed on {oc['name']}."
    if t == "demand_territory":
        from ..sim.war import start_war, transfer_province
        ps = a["provinces"]
        ratio = total_power(c) / max(0.01, total_power(oc) + sum(total_power(state["countries"][x]) for x in sorted(allies(state, tgt))))
        if state["meta"].get("player") != tgt and ratio > 2.2 and oc["leader"]["traits"]["agg"] < 0.75 and rng.random() < 0.8:
            for p in ps:
                transfer_province(state, p, actor, "annexation")
            add_memory(state, tgt, actor, "territory_lost", -40, f"Forced to cede territory to {c['name']} in {year}.")
            emit(state, "diplomacy", f"{oc['name']} yields territory to {c['name']}", f"Under pressure, {oc['name']} ceded {len(ps)} province(s).", [actor, tgt], 4, ps[:6])
            return f"{oc['name']} yielded {len(ps)} province(s)."
        if a.get("war_if_refused"):
            start_war(state, actor, tgt, "conquest", targets=ps)
            return f"{oc['name']} refused. War has begun."
        modify(state, tgt, actor, -20)
        return f"{oc['name']} refused the demand."
    if t == "cede_territory":
        from ..sim.war import transfer_province
        for p in a["provinces"]:
            transfer_province(state, p, tgt, "peaceful")
        modify(state, tgt, actor, 25)
        return f"Ceded {len(a['provinces'])} province(s) to {oc['name']}."
    if t == "annex_peacefully":
        from ..sim.war import destroy_country, transfer_province
        subject = oc.get("overlord") == actor
        ratio = total_power(c) / max(0.01, total_power(oc))
        if subject or opinion(state, tgt, actor) > 50 or (ratio > 6 and not allies(state, tgt) - {actor}) or source == "history":
            ps = list(idx(state)["owned"].get(tgt, []))
            for p in ps:
                transfer_province(state, p, actor, "peaceful")
                if actor not in state["provinces"][p]["cores"] and state["provinces"][p]["culture"] == c["culture"]:
                    state["provinces"][p]["cores"].append(actor)
            build_index(state)
            destroy_country(state, tgt, actor, f"{oc['name']} was peacefully united with {c['name']} in {year}.")
            for x in state["countries"].values():
                if x["alive"] and x["tag"] not in (actor,):
                    modify(state, x["tag"], actor, -3)
            return f"{oc['name']} has been absorbed into {c['name']}."
        modify(state, tgt, actor, -10)
        return f"{oc['name']} refused to give up its independence."
    if t == "demand_subjugation":
        ratio = total_power(c) / max(0.01, total_power(oc) + sum(total_power(state["countries"][x]) for x in sorted(allies(state, tgt))))
        if state["meta"].get("player") != tgt and ratio > 4 and opinion(state, tgt, actor) > -40:
            oc["overlord"] = actor
            add_memory(state, tgt, actor, "interference", -25, f"Forced into subordination by {c['name']} in {year}.")
            emit(state, "diplomacy", f"{oc['name']} becomes a subject of {c['name']}", "", [actor, tgt], 4)
            return f"{oc['name']} accepted our overlordship."
        modify(state, tgt, actor, -15)
        return f"{oc['name']} refused to submit."
    if t == "release_subject":
        if oc.get("overlord") == actor:
            oc["overlord"] = None
            add_memory(state, tgt, actor, "cooperation", 20, f"Released from subordination by {c['name']} in {year}.")
            return f"{oc['name']} is now fully independent."
        return f"{oc['name']} is not our subject."
    if t == "become_subject":
        c["overlord"] = tgt
        return f"{c['name']} is now a subject of {oc['name']}."
    if t == "grant_independence":
        from ..sim.successors import create_country, group_provinces
        made = []
        for g in group_provinces(state, a["provinces"], c["capital"]):
            nt = create_country(state, g, parent=actor, kind="grant", rng=rng, name=a.get("name") if len(made) == 0 and a.get("name") else None,
                                origin=f"Granted independence by {c['name']} in {year}.")
            add_memory(state, nt, actor, "cooperation", 15, f"{c['name']} granted independence peacefully in {year}.")
            made.append(state["countries"][nt]["name"])
            emit(state, "independence", f"{state['countries'][nt]['name']} becomes independent", f"{c['name']} has peacefully granted independence to {state['countries'][nt]['name']}.", [actor, nt], 4, g[:6], ["independence"])
        return f"Independence granted: {', '.join(made)}."
    if t == "dismantle_empire":
        from ..sim.successors import collapse_country
        mode = a.get("mode", "dismantle")
        pop_before = c["pop"]
        name = c["name"]
        created = collapse_country(state, actor, mode, rng)
        tot = sum(x["pop"] for x in state["countries"].values() if x["alive"]) or 1
        if pop_before > 0.15 * tot or len(created) >= 4:
            state["meta"]["last_great_collapse"] = {"tag": actor, "name": name, "adj": c["adj"], "year": year, "successors": created, "mode": mode}
            state["milestones"].append({"y": year, "title": f"{'Dissolution' if mode != 'collapse' else 'Collapse'} of {name}", "actors": [actor] + created[:6], "kind": "fall"})
        verb = {"dismantle": "dismantled", "decentralize": "decentralised", "collapse": "broken apart"}[mode]
        emit(state, "collapse", f"{name} {verb}", f"{name} has {verb} itself. {len(created)} new state(s) emerge: {', '.join(state['countries'][x]['name'] for x in created[:10])}{'...' if len(created) > 10 else ''}.",
             [actor] + created[:10], 5, tags=["fall", "successor"])
        if actor == state["meta"].get("player"):
            for m in state["missions"].values():
                if m["status"] == "active" and m["category"] in ("administrative", "military", "diplomatic", "economic", "political"):
                    m["status"] = "superseded"
                    m["closed"] = year
                    m["note"] = f"Overtaken by events: the {verb.replace('broken apart', 'collapse')} of {name}."
            for th in state["threads"].values():
                if th["status"] == "active" and th["kind"] in ("resistance", "overstretch") and actor in th["actors"]:
                    from ..story.threads import close_thread
                    close_thread(state, th["id"], f"Resolved by the end of the empire in {year}.")
            from ..story.missions import generate_missions
            generate_missions(state, actor)
        from ..story.threads import open_thread
        open_thread(state, "successor_age", f"After {name}", f"The {verb} of {name} in {year} left {len(created)} successor states to define a new order.", [actor] + created[:10], key=f"successors:{actor}:{year}")
        return f"{len(created)} successor states created."
    if t == "reunify":
        from ..sim.war import destroy_country, transfer_province
        heirs = {h.get("tag") for h in c.get("heritage", []) if h.get("tag")} | {actor}
        joined, refused = [], []
        for o, x in state["countries"].items():
            if not x["alive"] or o == actor:
                continue
            shared = heirs & ({h.get("tag") for h in x.get("heritage", [])} | set(x.get("predecessors", [])) | {o})
            if not shared:
                continue
            if opinion(state, o, actor) > 40 and total_power(c) > 1.5 * total_power(x) and o != state["meta"].get("player"):
                for p in list(idx(state)["owned"].get(o, [])):
                    transfer_province(state, p, actor, "peaceful")
                build_index(state)
                destroy_country(state, o, actor, f"{x['name']} voted to rejoin {c['name']} in {year}.")
                joined.append(x["name"])
            else:
                refused.append(x["name"])
                for p in idx(state)["owned"].get(o, []):
                    c["claims"].setdefault(p, year)
        if joined:
            emit(state, "reunification", f"Reunification: {', '.join(joined)} rejoin {c['name']}", "", [actor], 5, tags=["reunification"])
        return (f"Rejoined: {', '.join(joined)}. " if joined else "") + (f"Refused: {', '.join(refused[:6])} - claims registered." if refused else "")
    if t == "create_organization":
        kind = a.get("kind", "alliance")
        if kind not in ("alliance", "federation", "economic", "international", "bloc", "coalition", "union"):
            kind = "alliance"
        accepted, declined = [], []
        for m in a.get("members", []):
            mc = state["countries"][m]
            need = {"federation": 40, "union": 40, "alliance": 25, "economic": 0, "international": -10, "bloc": 15, "coalition": 15}[kind]
            if mc.get("overlord") == actor or _accepts(state, m, actor, need, rng):
                accepted.append(m)
            else:
                declined.append(mc["name"])
        oid = next_id(state, "org")
        state["orgs"][oid] = {"id": oid, "name": a.get("name"), "kind": kind, "founded": year, "members": [actor] + accepted, "leader": actor,
                              "desc": a.get("desc") or f"Founded by {c['name']} in {year}."}
        emit(state, "diplomacy", f"Founding of the {a.get('name')}", f"{c['name']} founded the {a.get('name')} ({kind}) with {', '.join(state['countries'][x]['name'] for x in accepted) or 'no other members yet'}.",
             [actor] + accepted, 4 if len(accepted) >= 3 else 3, tags=["organization"])
        state["milestones"].append({"y": year, "title": f"Founding of the {a.get('name')}", "actors": [actor] + accepted[:5], "kind": "organization"})
        return f"{a.get('name')} founded with {len(accepted)} other member(s)" + (f"; declined: {', '.join(declined[:8])}." if declined else ".")
    if t == "join_organization":
        org = state["orgs"].get(a.get("org"))
        if not org:
            return "No such organisation."
        avg = sum(opinion(state, m, actor) for m in org["members"]) / max(1, len(org["members"]))
        if avg > -5:
            org["members"].append(actor)
            return f"Joined the {org['name']}."
        return f"The members of the {org['name']} rejected our application."
    if t == "leave_organization":
        org = state["orgs"].get(a.get("org"))
        if org and actor in org["members"]:
            org["members"].remove(actor)
            return f"Left the {org['name']}."
        return "We are not a member."
    if t == "set_budget":
        old = c["budget"].get(a["category"], 0)
        c["budget"][a["category"]] = a["value"]
        return f"{a['category'].title()} spending set to {a['value'] * 100:.1f}% of GDP (was {old * 100:.1f}%)."
    if t == "set_policy":
        c["policies"][a["policy"]] = a["value"]
        if a["policy"] in ("digital_rights", "ai_rights") and a["value"] == "equal":
            emit(state, "law", f"{c['name']} grants equal rights to {'digital persons' if a['policy'] == 'digital_rights' else 'artificial minds'}",
                 "A landmark change in the legal definition of personhood.", [actor], 4, tags=["law", "rights"])
            state["milestones"].append({"y": year, "title": f"{c['name']}: equal rights for {'uploaded minds' if a['policy'] == 'digital_rights' else 'artificial minds'}", "actors": [actor], "kind": "law"})
        if a["policy"] == "integration" and a["value"] == "suppress":
            stab_add(c, -2)
        return f"Policy {a['policy'].replace('_', ' ')} set to {a['value']}."
    if t == "set_mobilization":
        c["policies"]["mobilization"] = a.get("level", "partial")
        return f"Mobilisation: {a.get('level')}."
    if t == "set_military_mix":
        mix = {k: max(0.0, float(a.get(k, c["mil_mix"].get(k, 0)))) for k in ("army", "navy", "air", "space")}
        s = sum(mix.values()) or 1
        c["mil_mix"] = {k: v / s for k, v in mix.items()}
        return "Military spending rebalanced: " + ", ".join(f"{k} {v * 100:.0f}%" for k, v in c["mil_mix"].items() if v)
    if t == "research":
        at = all_techs(state)
        if a.get("tech"):
            path = research_path(state, c, a["tech"])
            c["research"]["queue"] = path
            c["research"]["target"] = path[0] if path else None
            return f"Research directed toward {at[a['tech']]['name']} ({len(path)} step(s), starting with {at[path[0]]['name']})."
        c["focus"] = a["category"]
        c["research"]["target"] = None
        return f"Research focus: {a['category']}."
    if t == "change_government":
        from ..sim.stability import change_government
        ide = a.get("ideology") or c["ideology"]
        change_government(state, actor, ide, rng, reason="reform", gov=a.get("gov"))
        if a.get("title"):
            c["leader"]["title"] = a["title"][:40]
        if a.get("hereditary"):
            c["policies"]["succession"] = "hereditary"
            c.setdefault("dynasty", {"name": c["leader"]["name"].split()[-1], "founded": year, "rulers": 1})
        stab_add(c, -6)
        return f"{c['name']} is now a {c['gov']} ({get_ideology(state, c['ideology'])['name']})."
    if t == "create_ideology":
        axes = a.get("axes") or {}
        ide = invent_ideology(state, axes, a.get("context") or f"the vision of {c['leader']['name']} of {c['name']}", actor, year,
                              name=a.get("name"), desc=a.get("desc"))
        ide["founder_leader"] = c["leader"]["name"]
        emit(state, "ideology", f"A new ideology: {ide['name']}", f"{c['leader']['name']} of {c['name']} has proclaimed {ide['name']}: {ide['desc']}", [actor], 4, tags=["ideology"], data={"ideology": ide["id"]})
        state["milestones"].append({"y": year, "title": f"Proclamation of {ide['name']}", "actors": [actor], "kind": "ideology"})
        msg = f"New ideology created: {ide['name']}."
        if a.get("adopt", True):
            from ..sim.stability import change_government
            change_government(state, actor, ide["id"], rng, reason="reform", gov=a.get("gov"))
            stab_add(c, -5)
            msg += f" {c['name']} adopts it as its governing doctrine."
        return msg
    if t == "pass_law":
        name = (a.get("name") or "New Law")[:80]
        low = (name + " " + a.get("text", "")).lower()
        eff: dict = {}
        notes = []
        for keys, spec in LAW_KEYWORDS:
            if any(k in low for k in keys):
                if "policy" in spec:
                    pol, val = spec["policy"]
                    c["policies"][pol] = val
                    notes.append(f"{pol.replace('_', ' ')} -> {val}")
                for k, v in spec.get("eff", {}).items():
                    eff[k] = eff.get(k, 0) + v
                if spec.get("law_kind") == "succession":
                    c["policies"]["succession_law"] = "codified"
        c["laws"].append({"name": name, "text": a.get("text", ""), "year": year, "eff": {k: v for k, v in eff.items() if k in ("prod", "research")}, "kind": "law"})
        if eff.get("stab"):
            c.setdefault("temp_mods", []).append({"until": year + 10, "stability": eff["stab"]})
        from ..sim.core import compute_mods
        compute_mods(state, c)
        emit(state, "law", f"{c['name']} enacts the {name}", (a.get("text") or name) + (f" ({'; '.join(notes)})" if notes else ""), [actor], 3, tags=["law"])
        if any(k in low for k in ("artificial", "digital", "upload", "planetary", "constitution")):
            state["milestones"].append({"y": year, "title": f"{name} ({c['name']})", "actors": [actor], "kind": "law"})
        return f"Enacted: {name}." + (f" Effects: {'; '.join(notes)}." if notes else "")
    if t in ("national_initiative", "narrative"):
        from ..sim.projects import new_project
        cs = a.get("cost_share", 0.01)
        yrs = a.get("years", 3)
        kind = a.get("kind", "initiative")
        pr = new_project(state, c, kind, a.get("name", "National Programme")[:80], cs * c["gdp"] * yrs, yrs, a.get("effects", {}),
                         a.get("desc") or a.get("name", ""), source=source)
        return f"Programme launched: {pr['name']} ({fmt_money(pr['cost'])} over {pr['years']:g} years)."
    if t == "colonize":
        from ..sim.space import start_colony
        pr = start_colony(state, actor, a["region"], source)
        if not pr:
            raise ValueError("the expedition could not be organised")
        return f"Expedition launched: {pr['name']} ({fmt_money(pr['cost'])} over {pr['years']:.0f} years)."
    if t == "megaproject":
        from ..sim.projects import new_project
        name, req, cost, years, eff = MEGA[a["kind"]]
        body = a.get("body", "mars")
        if a["kind"] == "mass_upload":
            c["policies"]["upload"] = "mass"
        if a["kind"] == "interstellar_expedition":
            from ..sim.space import start_colony, unlock_body
            for b in ("proxima", "tau_ceti", "trappist"):
                unlock_body(state, b, actor)
            free = [p for p, x in state["provinces"].items() if x["body"] == a.get("body", "proxima") and not x["owner"]] or \
                   [p for p, x in state["provinces"].items() if x["body"] in ("proxima", "tau_ceti", "trappist") and not x["owner"]]
            if not free:
                return "No unclaimed worlds remain within reach."
            pr = start_colony(state, actor, free[0], source)
            return f"Interstellar colony fleet launched toward {state['extra_geo'][free[0]]['name']} - arrival in about {pr['years']:.0f} years." if pr else "Launch failed."
        pr = new_project(state, c, a["kind"], name.format(b=body.title()), cost, years, eff, f"{name.format(b=body.title())}.", target=body if a["kind"] == "terraform" else None, source=source)
        return f"Megaproject begun: {pr['name']} ({fmt_money(cost)} over {years} years)."
    if t == "rename_country":
        old = c["name"]
        c["name"] = a["name"][:60]
        if a.get("adj"):
            c["adj"] = a["adj"][:40]
        emit(state, "politics", f"{old} becomes {c['name']}", f"The state formerly known as {old} has been renamed {c['name']}.", [actor], 4, tags=["rename"])
        state["milestones"].append({"y": year, "title": f"Proclamation of {c['name']}", "actors": [actor], "kind": "founding"})
        return f"The state is now called {c['name']}."
    if t == "move_capital":
        c["capital"] = a["province"]
        return f"Capital moved to {state.get('extra_geo', {}).get(a['province'], {}).get('name') or get_geo().name(a['province'])}."
    if t == "espionage":
        op = a.get("op", "investigate")
        power = (c.get("gpc", 1) / max(1, oc.get("gpc", 1))) ** 0.3
        p = clamp(0.45 * power + (60 - oc["stability"]) / 150, 0.1, 0.9)
        success = rng.random() < p
        c["treasury"] -= c["gdp"] * 0.001
        if op == "investigate":
            from ..story.missions import reveal_hidden
            revealed = reveal_hidden(state, actor) if tgt == actor or True else []
            info = {"year": year, "ambitions": oc.get("ambitions", [])[:5], "claims_on_us": sum(1 for p_ in oc["claims"] if state["provinces"].get(p_, {}).get("owner") == actor),
                    "secret_treaties": [tr["name"] for tr in state["treaties"] if tgt in tr["members"] and tr.get("secret")],
                    "army": round(oc["army"]), "research": oc["research"].get("target"), "opinion_of_us": round(opinion(state, tgt, actor))}
            state.setdefault("intel", {})[tgt] = info
            return f"Intelligence report on {oc['name']} compiled." + (f" Uncovered {len(revealed)} hidden matter(s)." if revealed else "")
        if not success:
            add_memory(state, tgt, actor, "interference", -30, f"Exposed a {c['adj']} covert operation ({op}) in {year}.")
            modify(state, tgt, actor, -20, -15)
            emit(state, "espionage", f"{c['adj']} spies exposed in {oc['name']}", f"{oc['name']} has uncovered a {c['adj']} {op.replace('_', ' ')} operation.", [actor, tgt], 3, tags=["espionage"])
            return f"The operation failed and was exposed. {oc['name']} will not forget."
        if op == "steal_tech":
            cand = [x for x in oc["techs"] if x not in c["techs"] and all(pq in c["techs"] for pq in all_techs(state)[x]["pre"])]
            if not cand:
                return "Nothing worth stealing."
            from ..sim.economy import grant_tech
            tid = rng.choice(cand)
            grant_tech(state, c, tid, 1.0, quiet=True)
            return f"Our agents obtained the secrets of {all_techs(state)[tid]['name']}."
        if op == "sabotage":
            oc["research"]["progress"] = oc["research"].get("progress", 0) * 0.5
            for pid in idx(state)["owned"].get(tgt, [])[:5]:
                state["provinces"][pid]["dev"] = max(0.5, state["provinces"][pid]["dev"] - 0.05)
            return f"Sabotage in {oc['name']} succeeded."
        if op == "incite":
            for pid in idx(state)["owned"].get(tgt, []):
                if tgt not in state["provinces"][pid]["cores"] or rng.random() < 0.2:
                    state["provinces"][pid]["unrest"] = clamp(state["provinces"][pid]["unrest"] + 15, 0, 100)
            return f"Unrest incited in {oc['name']}."
        if op == "coup":
            if rng.random() < 0.5:
                from ..sim.stability import change_government
                change_government(state, tgt, c["ideology"], rng, reason="coup")
                oc["overlord"] = oc.get("overlord")
                modify(state, tgt, actor, 30)
                return f"Coup succeeded: {oc['name']} now has a government sympathetic to us."
            return "The coup attempt fizzled without exposing us."
    if t == "found_religion":
        name = (a.get("name") or "The New Faith")[:60]
        faiths = state.setdefault("faiths", {})
        faiths[name] = {"name": name, "founded": year, "founder": actor, "desc": a.get("desc", ""), "adherents": [actor]}
        stab_add(c, 3)
        c["legitimacy"] = clamp(c["legitimacy"] + 5, 0, 100)
        c["faith"] = name
        emit(state, "religion", f"Founding of {name}", f"{c['name']} has proclaimed a new faith: {name}. {a.get('desc', '')}", [actor], 4, tags=["religion"])
        state["milestones"].append({"y": year, "title": f"Founding of {name}", "actors": [actor], "kind": "religion"})
        return f"{name} founded and adopted as the state faith."
    if t == "strategic_goal":
        from ..story.missions import add_mission
        m = add_mission(state, a.get("mission", {}), source="player")
        return f"Strategic objective recorded: {m['title']}." if m else "Strategic objective noted."
    return "Done."
