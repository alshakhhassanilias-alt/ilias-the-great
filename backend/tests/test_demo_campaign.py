"""The mandatory demonstration campaign: Germany 1936 -> world dominance -> centuries -> planetary government ->
advanced technology -> Mars -> digital consciousness -> Earth-Mars tension -> new missions -> imperial collapse ->
successor states, verifying that the chronicle preserves everything."""
import time

from app import service as S
from app.memory.store import count_events, list_summaries, query_events
from app.sim.core import allies, at_war, total_power
from app.sim.relations import neighbors_of


def st(cid):
    return S.load(cid)[0]


def adv_to(cid, year):
    while st(cid)["meta"]["year"] < year:
        s = st(cid)
        S.advance(cid, (year - s["meta"]["year"]) * 12)
        s = st(cid)
        for d in list(s["decisions"]):
            opt = next((o["id"] for o in d["options"] if o["id"] in ("autonomy", "represent", "equal", "accept", "march", "annex", "invade", "heir")), d["options"][0]["id"])
            S.decide(cid, d["id"], opt)


def player(cid):
    s = st(cid)
    return s, s["countries"][s["meta"]["player"]]


def test_full_demonstration_campaign():
    t0 = time.time()
    # 1. Germany, 1936
    cid = S.create_campaign("1936", "GER", settings={"difficulty": "sandbox", "pause_on_decision": True}, seed=11)
    s, g = player(cid)
    assert g["name"] == "Germany" and s["meta"]["year"] == 1936
    assert S.briefing(cid)["sections"]
    missions_1936 = {m["key"] for m in s["missions"].values()}
    # 2. industrialise
    r = S.execute(cid, "Transform Germany into the world's largest industrial economy")
    assert r["ok"] and any(p["kind"] == "industrialisation" for p in player(cid)[1]["projects"])
    S.execute(cid, "Set military spending to 20% of GDP")
    S.execute(cid, "Invest 6% of GDP into scientific research")
    gdp0 = player(cid)[1]["gdp"]
    adv_to(cid, 1938)
    assert player(cid)[1]["gdp"] > gdp0
    # 3. expand territorially
    S.execute(cid, "Declare war on Austria")
    adv_to(cid, 1940)
    assert any(p["owner"] == "GER" and p["code"] == "AUT" for p in st(cid)["provinces"].values())
    # 4. global dominance
    year = st(cid)["meta"]["year"]
    S.execute(cid, "Set welfare spending to 4% of GDP")
    while st(cid)["meta"].get("phase") not in ("planetary_hegemon", "interplanetary_hegemon") and year < 2150:
        s = st(cid)
        g = s["countries"]["GER"]
        assert g["alive"], "the empire survives its wars of conquest"
        busy = sum(1 for w in s["wars"] if "GER" in w["att"] + w["def"])
        if g["stability"] < 40:
            # follow the strategist's advice: buy social peace and loosen the grip on conquered lands
            S.execute(cid, "Set welfare spending to 7% of GDP")
            S.execute(cid, "Set integration policy to autonomy")
        if g["stability"] > 30 and busy < 3:
            def coalition(t):
                return total_power(s["countries"][t]) + sum(total_power(s["countries"][a]) for a in sorted(allies(s, t)) if a != "GER")
            nb = sorted((t for t in neighbors_of(s, "GER") if not at_war(s, "GER", t) and s["countries"][t].get("overlord") != "GER"), key=coalition)
            for t in [t for t in nb if total_power(g) > 4 * coalition(t)][:3]:
                S.execute(cid, f"Demand that {s['countries'][t]['name']} become our subject")
            s = st(cid)
            nb = [t for t in nb if s["countries"][t]["alive"] and s["countries"][t].get("overlord") != "GER"]
            for t in [t for t in nb if total_power(g) > 0.8 * coalition(t)][:3]:
                S.execute(cid, f"Declare war on {s['countries'][t]['name']}")
        year += 4
        adv_to(cid, year)
    s, g = player(cid)
    assert s["meta"]["phase"] in ("planetary_hegemon", "interplanetary_hegemon"), s["meta"].get("phase_metrics")
    hegemon_keys = {m["key"] for m in s["missions"].values()}
    assert {"planetary_gov", "unified_science"} & hegemon_keys, "global dominance produces planetary-administration missions"
    assert not ({"protector"} & hegemon_keys - missions_1936)
    # 5. advance several centuries
    dominance_year = s["meta"]["year"]
    S.execute(cid, "Set integration policy to autonomy")
    S.execute(cid, "Invest 8% of GDP into scientific research")
    adv_to(cid, dominance_year + 200)
    s, g = player(cid)
    assert g["alive"] and s["meta"]["year"] - 1936 >= 200
    # 6. planetary government
    r = S.execute(cid, "Establish a planetary government")
    assert player(cid)[1]["gov"] == "Planetary Government"
    S.execute(cid, "Set military spending to 4% of GDP")
    # 7. advanced technologies
    if "mars_colonization" not in player(cid)[1]["techs"]:
        assert S.execute(cid, "Research Mars Colonization")["ok"]
    for _ in range(15):
        if "mars_colonization" in player(cid)[1]["techs"]:
            break
        adv_to(cid, st(cid)["meta"]["year"] + 10)
    s, g = player(cid)
    assert "mars_colonization" in g["techs"], len(g["techs"])
    assert len(g["techs"]) > 60
    # 8. Mars colonisation
    free = [p for p in st(cid)["provinces"].values() if p["body"] == "mars" and not p["owner"]]
    if free:
        r = S.execute(cid, "Begin the colonization of Mars")
        assert r["ok"], r
        adv_to(cid, st(cid)["meta"]["year"] + 12)
    if not any(p["owner"] == "GER" and p["body"] == "mars" for p in st(cid)["provinces"].values()):
        # every region of Mars was settled by others during the centuries we spent on Earth: take it by force
        if "space_warfare" not in player(cid)[1]["techs"]:
            S.execute(cid, "Research Space Warfare")
        for _ in range(10):
            if "space_warfare" in player(cid)[1]["techs"]:
                break
            adv_to(cid, st(cid)["meta"]["year"] + 5)
        S.execute(cid, "Build a space fleet")
        adv_to(cid, st(cid)["meta"]["year"] + 3)
        r = S.execute(cid, "Conquer Mars")
        assert r["ok"], r
        for _ in range(15):
            s = st(cid)
            if any(p["owner"] == "GER" and p["body"] == "mars" for p in s["provinces"].values()):
                break
            for w in [w for w in s["wars"] if "GER" in w["att"]]:
                if any(p["ctrl"] == "GER" and p["owner"] != "GER" and p["body"] == "mars" for p in s["provinces"].values()):
                    S.execute(cid, f"Make peace with {s['countries'][w['lead_def']]['name']} and annex the occupied territory")
            adv_to(cid, st(cid)["meta"]["year"] + 2)
    s, g = player(cid)
    mars = [p for p in s["provinces"].values() if p["owner"] == "GER" and p["body"] == "mars"]
    assert mars, "a German settlement exists on Mars"
    # 10. Earth-Mars tension emerges over the following generations
    S.execute(cid, "Set colonial policy to direct")
    seen_tension = False
    for _ in range(12):
        adv_to(cid, st(cid)["meta"]["year"] + 10)
        s = st(cid)
        if any(th["kind"] == "colonial_tension" and "GER" in th["actors"] for th in s["threads"].values()):
            seen_tension = True
            break
    assert seen_tension, "Earth-Mars political tension arises"
    assert query_events(cid, q="Mars tensions", limit=5) or query_events(cid, q="Mars congress", limit=5)
    # 9. digital consciousness
    if "digital_consciousness" not in player(cid)[1]["techs"]:
        S.execute(cid, "Research digital consciousness")
    for _ in range(20):
        if "digital_consciousness" in player(cid)[1]["techs"]:
            break
        adv_to(cid, st(cid)["meta"]["year"] + 10)
    assert "digital_consciousness" in player(cid)[1]["techs"]
    S.execute(cid, "Introduce a law granting digital minds equal citizenship")
    r = S.execute(cid, "Transfer all human consciousness into digital infrastructure")
    assert r["ok"]
    adv_to(cid, st(cid)["meta"]["year"] + 15)
    s, g = player(cid)
    assert g["pops"]["dig"] > 0
    # 11. an entirely new set of missions
    late_keys = {m["key"] for m in s["missions"].values()}
    assert late_keys - hegemon_keys, "the late campaign has new objectives"
    assert any(k.split(":")[0] in ("digital_constitution", "bio_digital_accord", "habitats", "colq", "rights", "space_fleet", "terraform_mars", "mars") for k in late_keys)
    # 12. collapse the original imperial system
    n_alive = sum(1 for c in s["countries"].values() if c["alive"])
    r = S.execute(cid, "Deliberately dismantle my empire and allow successor states to emerge")
    assert r["ok"]
    s = st(cid)
    # 13. successor states
    successors = [t for t, c in s["countries"].items() if c["alive"] and "GER" in c.get("predecessors", [])]
    assert len(successors) >= 5 and sum(1 for c in s["countries"].values() if c["alive"]) > n_alive
    assert s["meta"]["last_great_collapse"]["tag"] == "GER"
    assert any(m["status"] == "superseded" and "Overtaken by events" in (m.get("note") or "") for m in s["missions"].values())
    assert any(m["key"].startswith(("guardian:", "reconcile:", "rump:")) for m in s["missions"].values() if m["status"] == "active")
    adv_to(cid, s["meta"]["year"] + 5)
    # 14. the chronicle preserves all previous events
    assert count_events(cid) > 1000
    assert query_events(cid, q="campaign begins Germany 1936", limit=3)
    assert query_events(cid, year_from=1936, year_to=1940, min_importance=3, limit=5)
    assert query_events(cid, q="Planetary Constitution", limit=3)
    assert query_events(cid, q="dismantled", min_importance=5, limit=3)
    assert len([x for x in list_summaries(cid) if x["level"] == "century"]) >= 2
    doc = S.write_history(cid, f"Write the history of Germany from 1936 to {st(cid)['meta']['year']}")
    assert doc["chapters"][0]["title"].startswith("1936") and str(st(cid)["meta"]["year"])[:2] in doc["chapters"][-1]["title"]
    print(f"demo campaign reached {st(cid)['meta']['year']} in {time.time() - t0:.0f}s with {count_events(cid)} recorded events")
