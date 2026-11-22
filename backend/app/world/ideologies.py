"""Political ideologies: a base registry and a generator for entirely new doctrines that
emerge from campaign conditions. Axes are in [-1, 1]:
econ (planned..market), auth (liberty..authority), prog (traditional..transformative),
central (federal..unitary), substrate (biological-only..substrate-neutral)."""
from __future__ import annotations

from ..util import rng_for

BASE: dict[str, dict] = {}


def _add(iid, name, family, econ, auth, prog, central, substrate, desc, supporters, opponents, econ_policy):
    BASE[iid] = dict(id=iid, name=name, family=family, axes=dict(econ=econ, auth=auth, prog=prog, central=central, substrate=substrate),
                     desc=desc, supporters=supporters, opponents=opponents, economy=econ_policy, origin=None, founder=None, custom=False)


_add("liberal_democracy", "Liberal Democracy", "democratic", 0.5, -0.6, 0.2, 0.0, -0.4,
     "Representative government, civil liberties and the rule of law.", "urban middle classes, merchants, professionals",
     "authoritarians, revolutionaries", "Regulated markets and free trade.")
_add("social_democracy", "Social Democracy", "democratic", -0.2, -0.4, 0.3, 0.1, -0.3,
     "Democratic reform toward a welfare state.", "trade unions, industrial workers", "laissez-faire liberals, communists",
     "Mixed economy with strong public services.")
_add("conservatism", "Conservatism", "democratic", 0.4, 0.1, -0.5, 0.2, -0.7,
     "Continuity of institutions, faith and tradition.", "landowners, clergy, rural voters", "radicals of every stripe",
     "Protected property and cautious reform.")
_add("constitutional_monarchy", "Constitutional Monarchy", "monarchic", 0.3, -0.1, -0.2, 0.3, -0.7,
     "A crowned head of state bound by a constitution.", "aristocracy, loyalists", "republicans", "Market economy under royal patronage.")
_add("absolute_monarchy", "Absolute Monarchy", "monarchic", 0.0, 0.8, -0.7, 0.8, -0.8,
     "Sovereignty vested in a hereditary ruler.", "court nobility, clergy", "liberals, republicans", "Royal monopolies and tribute.")
_add("fascism", "Fascism", "authoritarian", 0.1, 0.9, -0.2, 0.9, -0.8,
     "Ultranationalist dictatorship subordinating the individual to the state.", "nationalists, veterans, industrialists",
     "communists, liberals, minorities", "Corporatist state-directed capitalism.")
_add("national_socialism", "National Socialism", "authoritarian", 0.0, 1.0, -0.1, 1.0, -0.9,
     "Totalitarian racial nationalism under a single leader.", "party apparatus, militarists", "nearly all other ideologies",
     "Autarkic rearmament economy.")
_add("communism", "Marxist-Leninist Communism", "socialist", -1.0, 0.8, 0.5, 0.9, -0.3,
     "A vanguard party building socialism through state ownership.", "party cadres, industrial workers", "capitalists, monarchists, fascists",
     "Central planning and collectivisation.")
_add("anarchism", "Anarcho-Syndicalism", "socialist", -0.8, -1.0, 0.5, -1.0, 0.0,
     "Stateless federations of workers' unions.", "syndicates, peasant communes", "every state", "Worker self-management.")
_add("military_junta", "Military Rule", "authoritarian", 0.2, 0.8, -0.3, 0.7, -0.6,
     "Government by the officer corps.", "army officers", "civilian politicians", "Order-first state capitalism.")
_add("theocracy", "Theocracy", "religious", 0.0, 0.7, -0.9, 0.6, -1.0,
     "Rule by religious authorities and sacred law.", "clergy, devout masses", "secularists", "Charitable endowments and tithes.")
_add("imperial_federalism", "Imperial Federalism", "imperial", 0.3, 0.4, 0.1, -0.2, -0.3,
     "A crown or central throne presiding over self-governing realms.", "imperial elites, provincial governors",
     "separatists, centralists", "Imperial customs union.")
_add("technocracy", "Technocracy", "technocratic", 0.2, 0.4, 0.8, 0.5, 0.3,
     "Government by experts and measurable outcomes.", "scientists, engineers, planners", "populists, traditionalists",
     "Evidence-planned investment.")
_add("corporatocracy", "Corporate Governance", "corporate", 1.0, 0.5, 0.5, 0.2, 0.2,
     "Sovereignty exercised by chartered corporations.", "shareholders, executives", "unions, nationalists", "Shareholder sovereignty.")
_add("tribal_confederation", "Tribal Confederation", "traditional", 0.0, 0.1, -0.8, -0.7, -1.0,
     "Clans and chiefdoms bound by custom and kinship.", "clan elders", "centralisers", "Pastoral and tributary economies.")
_add("city_state_republic", "Mercantile Republic", "democratic", 0.8, -0.2, 0.0, 0.3, -0.8,
     "Oligarchic republic of merchant houses.", "merchant guilds", "feudal lords", "Trade monopolies and banking.")
_add("planetarism", "Planetarism", "post-national", 0.0, 0.2, 0.6, 0.6, 0.0,
     "Humanity governed as a single planetary polity.", "global bureaucracy, cosmopolitans", "nationalists, separatists",
     "Planet-wide coordinated economy.")
_add("algorithmic_governance", "Algorithmic Governance", "artificial", -0.2, 0.6, 0.9, 0.8, 0.9,
     "Policy delegated to artificial intelligence administrators.", "efficiency advocates, AI systems", "humanists",
     "Continuously optimised allocation.")
_add("substrate_egalitarianism", "Substrate Egalitarianism", "transhumanist", -0.1, -0.4, 0.9, 0.0, 1.0,
     "Equal rights for every mind, biological or digital.", "uploaded persons, AI citizens", "bio-conservatives",
     "Universal compute dividends.")
_add("bio_conservatism", "Bio-Conservatism", "traditional", 0.2, 0.3, -0.9, 0.2, -1.0,
     "Defence of unmodified biological humanity.", "naturalists, religious movements", "transhumanists, uploads",
     "Restrictions on enhancement and emulation.")
_add("collective_unity", "Collective Unity", "collective", -0.9, 0.5, 1.0, 1.0, 1.0,
     "Merged consciousness acting as a single deliberative self.", "merged collectives", "individualists", "Shared allocation by consensus of the whole.")

FAMILY_GOV = {
    "democratic": "Parliamentary Republic", "monarchic": "Monarchy", "authoritarian": "Single-Party State",
    "socialist": "Socialist Republic", "religious": "Theocracy", "imperial": "Imperial Federation",
    "technocratic": "Technocratic Directorate", "corporate": "Corporate Charter State", "traditional": "Confederation",
    "post-national": "Planetary Government", "artificial": "AI Administration", "transhumanist": "Digital Republic",
    "collective": "Collective Consciousness",
}

_ROOTS = {
    "econ+": ["Mercantile", "Free", "Market"], "econ-": ["Commonwealth", "Communal", "Cooperative"],
    "auth+": ["Sovereign", "Directorial", "Unitary", "Ordered"], "auth-": ["Libertarian", "Open", "Councilist"],
    "prog+": ["Ascendant", "Futurist", "Transcendent", "Neo"], "prog-": ["Restorationist", "Traditionalist", "Ancestral", "Heritage"],
    "central+": ["Integralist", "Centralist"], "central-": ["Federalist", "Autonomist", "Confederal"],
    "substrate+": ["Synthetic", "Post-Biological", "Substrate"], "substrate-": ["Organic", "Humanist", "Vital"],
}
_NOUNS = ["Humanism", "Republicanism", "Syndicalism", "Accord", "Doctrine", "Way", "Covenant", "Movement", "Unionism", "Concord", "Mandate"]


def similarity(a: dict, b: dict) -> float:
    """1 = identical, 0 = maximally opposed."""
    ax, bx = a["axes"], b["axes"]
    d = sum((ax[k] - bx[k]) ** 2 for k in ax) ** 0.5
    return max(0.0, 1 - d / (2 * 5 ** 0.5))


def invent_ideology(state: dict, axes: dict, context: str, origin_country: str | None, year: int,
                    name: str | None = None, desc: str | None = None, family: str | None = None) -> dict:
    """Create a brand-new ideology anchored to actual campaign context."""
    reg = state.setdefault("ideologies", {})
    rng = rng_for(state["meta"]["seed"], "ideology", len(reg), context)
    if not name:
        dom = sorted(axes.items(), key=lambda kv: -abs(kv[1]))
        r1 = rng.choice(_ROOTS[dom[0][0] + ("+" if dom[0][1] >= 0 else "-")])
        r2 = rng.choice(_ROOTS[dom[1][0] + ("+" if dom[1][1] >= 0 else "-")])
        name = f"{r1} {r2} {rng.choice(_NOUNS)}" if r1 != r2 else f"{r1} {rng.choice(_NOUNS)}"
    iid = "custom_" + "".join(ch for ch in name.lower().replace(" ", "_") if ch.isalnum() or ch == "_")[:40]
    if iid in reg:
        return reg[iid]
    if not family:
        if axes.get("substrate", 0) > 0.6:
            family = "transhumanist"
        elif axes.get("auth", 0) > 0.6:
            family = "authoritarian"
        elif axes.get("econ", 0) < -0.6:
            family = "socialist"
        elif axes.get("prog", 0) < -0.6:
            family = "traditional"
        elif axes.get("auth", 0) < -0.3:
            family = "democratic"
        else:
            family = "technocratic"
    supporters = {
        "transhumanist": "uploaded citizens, enhanced professionals", "authoritarian": "security services, nationalist youth",
        "socialist": "workers' councils, the dispossessed", "traditional": "religious communities, rural populations",
        "democratic": "civic associations, reformers", "technocratic": "scientists and administrators",
    }.get(family, "a coalition of reformers")
    ideo = dict(id=iid, name=name, family=family, axes={k: float(axes.get(k, 0)) for k in ("econ", "auth", "prog", "central", "substrate")},
                desc=desc or f"A doctrine born from {context}.", supporters=supporters,
                opponents="defenders of the established order", economy="Shaped by its founders' circumstances.",
                origin=context, founder=origin_country, year=year, custom=True)
    reg[iid] = ideo
    return ideo


def get_ideology(state: dict, iid: str) -> dict:
    reg = state.get("ideologies", {})
    return reg.get(iid) or BASE.get(iid) or BASE["liberal_democracy"]
