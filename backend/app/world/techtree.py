"""Technology tree: authored historical/near-future techs plus procedurally generated
far-future techs, so there is no technological endpoint."""
from __future__ import annotations

from ..util import rng_for

CATS = ["industry", "military", "computing", "energy", "biology", "space", "society"]

# id: (name, category, tier, anchor_year, prereqs, effects, description)
_T = [
    ("agriculture", "Agriculture", "society", 0, -8000, [], {"prod": 0.05, "pop": 0.002}, "Settled farming and surplus."),
    ("bronze_working", "Bronze Working", "industry", 0, -3000, ["agriculture"], {"prod": 0.04, "military": 0.05}, "Alloyed tools and weapons."),
    ("writing", "Writing", "society", 0, -3200, ["agriculture"], {"research": 0.08}, "Records, law and memory."),
    ("iron_working", "Iron Working", "industry", 1, -1100, ["bronze_working"], {"prod": 0.05, "military": 0.06}, "Cheap, abundant iron."),
    ("currency", "Currency", "society", 1, -600, ["writing"], {"prod": 0.05}, "Coinage and markets."),
    ("philosophy", "Philosophy", "society", 1, -500, ["writing"], {"research": 0.08, "stab": 1}, "Systematic thought."),
    ("engineering", "Classical Engineering", "industry", 1, -300, ["iron_working", "currency"], {"prod": 0.05}, "Roads, aqueducts, cranes."),
    ("feudal_administration", "Feudal Administration", "society", 2, 800, ["engineering", "philosophy"], {"stab": 2}, "Layered loyalty and land tenure."),
    ("universities", "Universities", "society", 2, 1100, ["philosophy"], {"research": 0.1}, "Institutions of learning."),
    ("gunpowder", "Gunpowder", "military", 2, 1300, ["engineering"], {"military": 0.12}, "Firearms and cannon."),
    ("banking", "Banking", "society", 3, 1400, ["currency", "universities"], {"prod": 0.06}, "Credit and capital."),
    ("navigation", "Oceanic Navigation", "space", 3, 1450, ["universities"], {"prod": 0.03, "naval": 0.2}, "Blue-water sailing."),
    ("printing_press", "Printing Press", "computing", 3, 1450, ["universities"], {"research": 0.12}, "Mass reproduction of text."),
    ("scientific_method", "Scientific Method", "society", 4, 1650, ["printing_press"], {"research": 0.15}, "Experiment and proof."),
    ("steam_power", "Steam Power", "energy", 5, 1770, ["scientific_method"], {"prod": 0.12}, "Mechanical power from heat."),
    ("industrialization", "Industrialization", "industry", 5, 1800, ["steam_power", "banking"], {"prod": 0.2, "pop": 0.003}, "Factory production."),
    ("railroads", "Railroads", "industry", 6, 1830, ["industrialization"], {"prod": 0.1, "military": 0.05}, "Continental logistics."),
    ("telegraph", "Telegraph", "computing", 6, 1840, ["scientific_method", "industrialization"], {"prod": 0.03, "research": 0.05}, "Instant long-distance messages."),
    ("chemistry", "Modern Chemistry", "biology", 6, 1860, ["scientific_method"], {"prod": 0.05, "pop": 0.002}, "Fertilisers, dyes, explosives."),
    ("electricity", "Electrification", "energy", 7, 1880, ["telegraph"], {"prod": 0.12}, "Electric power grids."),
    ("internal_combustion", "Internal Combustion", "industry", 7, 1890, ["chemistry", "industrialization"], {"prod": 0.1, "military": 0.05}, "Engines, cars, tractors."),
    ("aviation", "Aviation", "military", 8, 1910, ["internal_combustion"], {"military": 0.08, "air": 0.3}, "Powered flight."),
    ("mass_production", "Mass Production", "industry", 8, 1913, ["electricity", "internal_combustion"], {"prod": 0.15}, "Assembly lines."),
    ("radio", "Radio", "computing", 8, 1920, ["electricity"], {"research": 0.04, "stab": 1}, "Broadcast communication."),
    ("mechanized_warfare", "Mechanized Warfare", "military", 8, 1918, ["internal_combustion"], {"military": 0.12}, "Tanks and motorised armies."),
    ("radar", "Radar", "military", 9, 1938, ["radio"], {"military": 0.08, "air": 0.2}, "Radio detection and ranging."),
    ("antibiotics", "Antibiotics", "biology", 9, 1942, ["chemistry"], {"pop": 0.004, "stab": 1}, "Defeat of bacterial disease."),
    ("jet_engine", "Jet Propulsion", "military", 9, 1942, ["aviation"], {"military": 0.08, "air": 0.4}, "Turbojet aircraft."),
    ("nuclear_fission", "Nuclear Fission", "energy", 10, 1942, ["electricity", "chemistry"], {"research": 0.03}, "Splitting the atom."),
    ("rocketry", "Rocketry", "space", 10, 1944, ["jet_engine", "chemistry"], {"military": 0.05}, "Liquid-fuel rockets."),
    ("electronic_computer", "Electronic Computers", "computing", 10, 1946, ["radio"], {"research": 0.1, "prod": 0.03}, "Programmable calculating machines."),
    ("nuclear_weapons", "Nuclear Weapons", "military", 11, 1945, ["nuclear_fission"], {"unlock": ["nukes"]}, "Weapons of mass destruction; deterrence."),
    ("transistor", "Transistor", "computing", 11, 1948, ["electronic_computer"], {"research": 0.06, "prod": 0.03}, "Solid-state electronics."),
    ("nuclear_power", "Nuclear Power", "energy", 11, 1954, ["nuclear_fission"], {"prod": 0.06}, "Civil fission reactors."),
    ("satellites", "Satellites", "space", 12, 1957, ["rocketry", "transistor"], {"research": 0.04, "military": 0.04}, "Orbital spacecraft."),
    ("integrated_circuits", "Integrated Circuits", "computing", 12, 1960, ["transistor"], {"research": 0.08, "prod": 0.05}, "Microchips."),
    ("crewed_spaceflight", "Crewed Spaceflight", "space", 12, 1961, ["satellites"], {"stab": 1}, "Humans in orbit."),
    ("green_revolution", "Green Revolution", "biology", 12, 1965, ["chemistry", "antibiotics"], {"pop": 0.004, "prod": 0.05}, "High-yield agriculture."),
    ("lunar_missions", "Lunar Missions", "space", 13, 1969, ["crewed_spaceflight", "integrated_circuits"], {"stab": 2, "research": 0.02}, "Crewed landings on the Moon."),
    ("genetic_engineering", "Genetic Engineering", "biology", 13, 1975, ["green_revolution", "integrated_circuits"], {"prod": 0.03, "pop": 0.001}, "Recombinant DNA."),
    ("personal_computing", "Personal Computing", "computing", 13, 1977, ["integrated_circuits"], {"prod": 0.06, "research": 0.05}, "Computers for everyone."),
    ("internet", "The Internet", "computing", 14, 1985, ["personal_computing"], {"prod": 0.08, "research": 0.1}, "A global network of networks."),
    ("precision_munitions", "Precision Munitions", "military", 14, 1991, ["integrated_circuits", "satellites"], {"military": 0.15}, "Guided weapons."),
    ("renewable_energy", "Renewable Energy", "energy", 14, 1995, ["integrated_circuits", "nuclear_power"], {"prod": 0.04, "stab": 1}, "Solar and wind at scale."),
    ("mobile_networks", "Mobile Networks", "computing", 15, 2000, ["internet"], {"prod": 0.05}, "Ubiquitous connectivity."),
    ("genome_sequencing", "Genome Sequencing", "biology", 15, 2001, ["genetic_engineering", "personal_computing"], {"pop": 0.001, "research": 0.03}, "Reading the code of life."),
    ("machine_learning", "Machine Learning", "computing", 16, 2012, ["internet", "mobile_networks"], {"prod": 0.06, "research": 0.08}, "Learning from data."),
    ("reusable_rockets", "Reusable Rockets", "space", 16, 2015, ["crewed_spaceflight", "personal_computing"], {"research": 0.02}, "Cheap access to orbit."),
    ("drone_warfare", "Drone Warfare", "military", 16, 2015, ["precision_munitions", "machine_learning"], {"military": 0.15}, "Unmanned combat systems."),
    ("advanced_ai", "Advanced AI", "computing", 17, 2028, ["machine_learning"], {"prod": 0.12, "research": 0.2}, "Large-scale artificial intelligence."),
    ("gene_therapy", "Gene Therapy", "biology", 17, 2030, ["genome_sequencing"], {"pop": 0.001, "stab": 1}, "Curing inherited disease."),
    ("quantum_computing", "Quantum Computing", "computing", 18, 2035, ["advanced_ai"], {"research": 0.15}, "Qubit-based computation."),
    ("autonomous_robotics", "Autonomous Robotics", "industry", 18, 2035, ["advanced_ai"], {"prod": 0.25}, "Robots that work unsupervised.", ),
    ("lunar_base", "Permanent Lunar Bases", "space", 18, 2035, ["reusable_rockets"], {"unlock": ["luna"]}, "Habitats at the lunar poles."),
    ("brain_computer_interfaces", "Brain-Computer Interfaces", "biology", 19, 2040, ["gene_therapy", "advanced_ai"], {"research": 0.06}, "Direct neural links."),
    ("closed_ecosystems", "Closed Ecosystems", "biology", 19, 2040, ["lunar_base", "genetic_engineering"], {"pop": 0.0005}, "Self-sustaining life support."),
    ("fusion_power", "Fusion Power", "energy", 19, 2045, ["quantum_computing", "renewable_energy"], {"prod": 0.25}, "Commercial fusion reactors."),
    ("artificial_general_intelligence", "Artificial General Intelligence", "computing", 20, 2050, ["quantum_computing", "autonomous_robotics"], {"prod": 0.2, "research": 0.35, "unlock": ["ai_minds"], "controversy": "ai"}, "Machine minds equal to humans in general reasoning."),
    ("human_enhancement", "Human Enhancement", "biology", 20, 2055, ["brain_computer_interfaces", "gene_therapy"], {"prod": 0.08, "research": 0.05, "unlock": ["enhancement"], "controversy": "enhancement"}, "Genetic and cybernetic augmentation."),
    ("mars_colonization", "Mars Colonization", "space", 21, 2060, ["closed_ecosystems", "fusion_power"], {"unlock": ["mars"]}, "Permanent settlements on Mars."),
    ("asteroid_mining", "Asteroid Mining", "space", 21, 2070, ["lunar_base", "autonomous_robotics"], {"prod": 0.08, "unlock": ["belt"]}, "Extraction of off-world resources."),
    ("orbital_infrastructure", "Orbital Infrastructure", "space", 21, 2075, ["asteroid_mining"], {"prod": 0.06}, "Space elevators, orbital rings, shipyards."),
    ("space_warfare", "Space Warfare", "military", 21, 2080, ["orbital_infrastructure", "drone_warfare"], {"military": 0.2, "unlock": ["space_military"]}, "Orbital and interplanetary combat."),
    ("nanofabrication", "Nanofabrication", "industry", 22, 2080, ["quantum_computing", "autonomous_robotics"], {"prod": 0.3}, "Atomically precise manufacturing."),
    ("connectome_mapping", "Connectome Mapping", "biology", 22, 2085, ["brain_computer_interfaces", "artificial_general_intelligence"], {"research": 0.08}, "Complete maps of human minds."),
    ("digital_consciousness", "Digital Consciousness", "computing", 23, 2100, ["connectome_mapping"], {"research": 0.15, "unlock": ["upload"], "controversy": "upload"}, "Mind uploading and emulated persons."),
    ("post_scarcity_economics", "Post-Scarcity Economics", "society", 23, 2100, ["nanofabrication", "fusion_power"], {"prod": 0.25, "stab": 3}, "Abundance-based economic systems."),
    ("fusion_propulsion", "Fusion Propulsion", "space", 23, 2110, ["fusion_power", "orbital_infrastructure"], {"unlock": ["outer"]}, "Fast transit to the outer planets."),
    ("synthetic_bodies", "Synthetic Bodies", "biology", 24, 2120, ["digital_consciousness", "nanofabrication"], {"pop": 0.001, "unlock": ["synthetic"]}, "Artificial bodies for emulated minds."),
    ("artificial_habitats", "Artificial Habitats", "space", 24, 2130, ["orbital_infrastructure", "nanofabrication"], {"pop": 0.001, "unlock": ["habitats"]}, "O'Neill cylinders and aerostats."),
    ("terraforming", "Terraforming", "space", 25, 2200, ["artificial_habitats", "mars_colonization"], {"unlock": ["terraform"]}, "Re-engineering whole planets."),
    ("antimatter_production", "Antimatter Production", "energy", 26, 2250, ["fusion_propulsion", "nanofabrication"], {"prod": 0.1, "military": 0.15}, "Industrial antimatter."),
    ("interstellar_probes", "Interstellar Probes", "space", 26, 2250, ["antimatter_production"], {"research": 0.05}, "Robotic missions to other stars."),
    ("dyson_swarm", "Dyson Swarm", "energy", 27, 2350, ["artificial_habitats", "antimatter_production"], {"prod": 0.45}, "Harvesting a meaningful fraction of the Sun's output."),
    ("collective_consciousness", "Collective Consciousness", "society", 27, 2400, ["synthetic_bodies", "digital_consciousness"], {"research": 0.2, "stab": 4, "controversy": "collective"}, "Voluntary merging of minds into shared selves."),
    ("interstellar_colonization", "Interstellar Colonization", "space", 28, 2450, ["interstellar_probes", "terraforming"], {"unlock": ["interstellar"]}, "Colony fleets to nearby stars."),
    ("stellar_engineering", "Stellar Engineering", "energy", 30, 2800, ["dyson_swarm"], {"prod": 0.35}, "Lifting and shaping stars."),
    ("metric_engineering", "Spacetime Metric Engineering", "space", 31, 3000, ["stellar_engineering", "interstellar_colonization"], {"research": 0.2, "military": 0.2}, "Manipulating the geometry of spacetime."),
]

TECHS: dict[str, dict] = {}
for row in _T:
    tid, name, cat, tier, year, pre, eff, desc = row
    TECHS[tid] = {"id": tid, "name": name, "cat": cat, "tier": tier, "year": year, "pre": pre, "eff": eff, "desc": desc}

UNLOCK_BODY = {"luna": ["luna"], "mars": ["mars"], "belt": ["belt"], "outer": ["jovian", "saturnian"],
               "habitats": ["venus"], "interstellar": ["proxima", "tau_ceti", "trappist"]}


def tech_cost(tier: int) -> float:
    return 3.0 * (1.36 ** tier)


_PREFIX = {
    "industry": ["Self-Replicating", "Programmable", "Femtoscale", "Ambient", "Morphic", "Coherent", "Living"],
    "military": ["Phase-Locked", "Kinetic", "Autonomic", "Relativistic", "Swarm", "Null-Field", "Graviton"],
    "computing": ["Recursive", "Noetic", "Hyperdimensional", "Ontological", "Distributed", "Reversible", "Holographic"],
    "energy": ["Vacuum", "Zero-Point", "Quark-Gluon", "Stellar", "Black-Hole", "Casimir", "Neutrino"],
    "biology": ["Panspermic", "Morphogenic", "Xenobiotic", "Senolytic", "Chimeric", "Neo-Organic", "Adaptive"],
    "space": ["Lagrange", "Wormhole", "Heliopause", "Interstellar", "Galactic", "Void", "Deep-Field"],
    "society": ["Consensual", "Plural", "Post-Material", "Polyphonic", "Civilisational", "Memetic", "Transcendent"],
}
_SUFFIX = {
    "industry": ["Fabrication", "Matter Compilers", "Foundries", "Assemblers", "Manufacture"],
    "military": ["Lances", "Doctrine", "Shields", "Deterrence", "Interdiction"],
    "computing": ["Cognition", "Lattices", "Archives", "Computation", "Simulation"],
    "energy": ["Harvesting", "Catalysis", "Engineering", "Reactors", "Taps"],
    "biology": ["Ecologies", "Genomics", "Medicine", "Synthesis", "Biospheres"],
    "space": ["Transit", "Gateways", "Navigation", "Arks", "Corridors"],
    "society": ["Governance", "Accords", "Ethics", "Polity", "Covenants"],
}


def generate_tech(state: dict, cat: str) -> dict:
    """Create the next procedural tech in a category, persisted in the campaign state."""
    gen = state.setdefault("gen_techs", {})
    n = sum(1 for t in gen.values() if t["cat"] == cat) + 1
    rng = rng_for(state["meta"]["seed"], "gentech", cat, n)
    prev = [t for t in gen.values() if t["cat"] == cat]
    if prev:
        pre = [max(prev, key=lambda t: t["tier"])["id"]]
        tier = max(t["tier"] for t in prev) + 1
    else:
        authored = [t for t in TECHS.values() if t["cat"] == cat]
        top = max(authored, key=lambda t: t["tier"])
        pre = [top["id"]]
        tier = max(top["tier"] + 1, 30)
    # cross-link with the most advanced generated/authored tech of another category
    other = rng.choice([c for c in CATS if c != cat])
    others = [t for t in gen.values() if t["cat"] == other]
    if others:
        pre.append(max(others, key=lambda t: t["tier"])["id"])
    name = f"{rng.choice(_PREFIX[cat])} {rng.choice(_SUFFIX[cat])}"
    if any(t["name"] == name for t in gen.values()):
        name += f" {['II','III','IV','V','VI','VII','VIII','IX','X'][min(8, n % 9)]}"
    eff: dict = {"industry": {"prod": 0.12}, "military": {"military": 0.12}, "computing": {"research": 0.1, "prod": 0.04},
                 "energy": {"prod": 0.1}, "biology": {"pop": 0.0005, "stab": 1}, "space": {"prod": 0.05, "research": 0.03},
                 "society": {"stab": 2, "prod": 0.04}}[cat]
    tid = f"gen_{cat}_{n}"
    t = {"id": tid, "name": name, "cat": cat, "tier": tier, "year": None, "pre": pre, "eff": dict(eff),
         "desc": f"A speculative {cat} breakthrough building on {', '.join(all_techs(state)[p]['name'] for p in pre if p in all_techs(state))}.",
         "generated": True}
    gen[tid] = t
    return t


def all_techs(state: dict | None) -> dict[str, dict]:
    if not state or not state.get("gen_techs"):
        return TECHS
    d = dict(TECHS)
    d.update(state["gen_techs"])
    return d


def available(state: dict, known: set[str]) -> list[dict]:
    at = all_techs(state)
    return [t for t in at.values() if t["id"] not in known and all(p in known for p in t["pre"])]


def ensure_frontier(state: dict, known: set[str]) -> None:
    """Guarantee that every category always has something researchable (infinite tree)."""
    av = available(state, known)
    cats = {t["cat"] for t in av}
    at = all_techs(state)
    for cat in CATS:
        if cat in cats:
            continue
        # only generate once the authored tree in this category is exhausted
        if all(t["id"] in known for t in at.values() if t["cat"] == cat):
            generate_tech(state, cat)


def initial_techs(year: int, development: float) -> set[str]:
    """Techs a society would plausibly know in a given year. development in [0,1] lags poorer states."""
    lag = (1 - development) * 45
    known = set()
    for t in sorted(TECHS.values(), key=lambda t: t["tier"]):
        if t["year"] is not None and t["year"] <= year - lag and all(p in known for p in t["pre"]):
            known.add(t["id"])
    return known
