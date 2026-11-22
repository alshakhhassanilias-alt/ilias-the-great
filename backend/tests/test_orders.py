from app.orders.actions import assess
from app.orders.executor import execute_actions
from app.orders.parser import interpret
from app.util import rng_for


def types(plan):
    return [a["type"] for a in plan["actions"]]


def test_spec_examples_are_understood(world_1936):
    s = world_1936
    cases = {
        "Transform Germany into the world's largest industrial economy": "national_initiative",
        "Unify Europe under a federal government": "create_organization",
        "Conquer the Soviet Union": "declare_war",
        "Establish a thousand-year imperial dynasty": "change_government",
        "Deliberately dismantle my empire and allow successor states to emerge": "dismantle_empire",
        "Allow the empire to peacefully decentralize": "dismantle_empire",
        "Invest 30% of national GDP into scientific research": "set_budget",
        "Establish a federation between all European countries": "create_organization",
        "Attempt to peacefully reunify the former empire": "reunify",
        "Create a new political ideology called Solar Syndicalism": "create_ideology",
        "Create a new global religion": "found_religion",
        "Introduce a law granting artificial consciousness equal citizenship": "pass_law",
    }
    for text, t in cases.items():
        assert t in types(interpret(s, "GER", text)), text


def test_impossible_requests_become_long_term_programmes(world_1936):
    plan = interpret(world_1936, "GER", "Begin the colonization of Mars")
    a = plan["actions"][0]
    assert not a["assessment"]["ok"] and a["assessment"]["alternative"]["type"] == "research"
    assert "breakthroughs" in a["assessment"]["explanation"]
    plan = interpret(world_1936, "GER", "Transfer all human consciousness into digital infrastructure")
    assert types(plan) == ["research"] and plan["actions"][0]["tech"] == "digital_consciousness"
    plan = interpret(world_1936, "GER", "Establish the first interstellar civilization")
    assert plan["actions"][0]["tech"] == "interstellar_colonization"


def test_execution_and_validation(world_1936):
    s = world_1936
    rng = rng_for(1, "t")
    r = execute_actions(s, "GER", [{"type": "set_budget", "category": "research", "value": 0.3}], rng)
    assert r["ok"] and s["countries"]["GER"]["budget"]["research"] == 0.3
    r = execute_actions(s, "GER", [{"type": "set_budget", "category": "research", "value": 0.9}], rng)
    assert not r["ok"], "absurd budgets are rejected"
    r = execute_actions(s, "GER", [{"type": "teleport_army", "target": "FRA"}], rng)
    assert not r["ok"], "unknown action types never execute"
    r = execute_actions(s, "GER", [{"type": "declare_war", "target": "ZZZ"}], rng)
    assert not r["ok"]


def test_compound_orders_and_complex_actions(world_1936):
    plan = interpret(world_1936, "GER", "Declare war on Poland and sign a non-aggression pact with the Soviet Union")
    assert types(plan) == ["declare_war", "propose_treaty"]
    war = plan["actions"][0]["assessment"]
    assert war["consequences"], "consequences explained"


def test_conquer_region_becomes_strategic_campaign(world_1936):
    plan = interpret(world_1936, "GER", "Conquer Europe")
    assert "strategic_goal" in types(plan)


def test_dismantle_and_reunify_flow(world_1936):
    s = world_1936
    rng = rng_for(2, "t")
    n0 = sum(1 for c in s["countries"].values() if c["alive"])
    execute_actions(s, "GBR", [{"type": "dismantle_empire", "mode": "dismantle"}], rng)
    assert sum(1 for c in s["countries"].values() if c["alive"]) > n0 + 10
    assert s["meta"]["last_great_collapse"]["tag"] == "GBR"


def test_create_ideology_records_origin(world_1936):
    s = world_1936
    execute_actions(s, "GER", [{"type": "create_ideology", "name": "Continental Syndicalism", "desc": "Unity of labour across the continent.", "axes": {"econ": -0.5}}], rng_for(1, "i"))
    ide = s["ideologies"]["custom_continental_syndicalism"]
    assert ide["founder"] == "GER" and ide["year"] == 1936
    assert s["countries"]["GER"]["ideology"] == ide["id"]
