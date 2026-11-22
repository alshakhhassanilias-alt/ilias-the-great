"""Scenario construction: historical starts (1914, 1936, 1962, 2026) and fictional worlds at any year."""
from __future__ import annotations

import math
import random

from ..util import clamp, rng_for, stable_hash
from . import scenario_data as D
from .factory import color_for, make_country, make_leader, random_traits
from .geo import CULTURE_OF, get_geo
from .ideologies import BASE, FAMILY_GOV
from .names import adjective, realm_root, state_name
from .techtree import initial_techs

GK = 1.9  # 1990 Geary-Khamis dollars -> approx. 2020 international dollars

SCENARIOS = {
    "1914": {"id": "1914", "name": "The Guns of August", "year": 1914, "month": 6, "kind": "historical",
             "desc": "June 1914: the eve of the Great War. Empires at their zenith, alliances primed to explode."},
    "1936": {"id": "1936", "name": "The Gathering Storm", "year": 1936, "month": 3, "kind": "historical",
             "desc": "March 1936: Depression, rearmament and the collapse of collective security."},
    "1962": {"id": "1962", "name": "Thirteen Days", "year": 1962, "month": 9, "kind": "historical",
             "desc": "September 1962: the Cold War at its most dangerous moment."},
    "2026": {"id": "2026", "name": "The Present Age", "year": 2026, "month": 1, "kind": "historical",
             "desc": "January 2026: the modern world on the threshold of advanced AI. (Minor-state leaders are fictionalised.)"},
    "fictional": {"id": "fictional", "name": "A World Unwritten", "year": None, "month": 1, "kind": "fictional",
                  "desc": "A procedurally generated world on real geography at any year you choose, with a coherent invented history."},
}

# regional default GDP per capita (1990 GK$) for territories not covered by a scenario's state figures
REGIONAL = {
    1914: {"Europe": 2000, "North America": 2500, "South America": 1500, "Asia": 600, "Africa": 550, "Oceania": 1800, "Western Asia": 900},
    1936: {"Europe": 2300, "North America": 2000, "South America": 1700, "Asia": 700, "Africa": 650, "Oceania": 1500, "Western Asia": 950},
    1962: {"Europe": 4200, "North America": 3000, "South America": 2600, "Asia": 1100, "Africa": 1000, "Oceania": 2500, "Western Asia": 2400},
}
POPFACTOR = {
    1914: {"Europe": 0.62, "Asia": 0.21, "Africa": 0.09, "North America": 0.25, "South America": 0.13, "Oceania": 0.18},
    1936: {"Europe": 0.72, "Asia": 0.27, "Africa": 0.11, "North America": 0.32, "South America": 0.18, "Oceania": 0.24},
    1962: {"Europe": 0.85, "Asia": 0.40, "Africa": 0.21, "North America": 0.52, "South America": 0.36, "Oceania": 0.42},
}
LEADERS_2026 = {
    "USA": ("Donald Trump", "President", 1946, (.6, .3, .3, .8, .6), "liberal_democracy", "Federal Presidential Republic"),
    "CHN": ("Xi Jinping", "General Secretary", 1953, (.5, .6, .4, .9, .7), "communism", "Socialist Single-Party State"),
    "RUS": ("Vladimir Putin", "President", 1952, (.75, .5, .2, .9, .6), "conservatism", "Presidential Republic (authoritarian)"),
    "IND": ("Narendra Modi", "Prime Minister", 1950, (.4, .6, .5, .7, .8), "conservatism", "Federal Parliamentary Republic"),
    "GBR": ("Keir Starmer", "Prime Minister", 1962, (.2, .7, .7, .4, .8), "social_democracy", "Constitutional Monarchy"),
    "FRA": ("Emmanuel Macron", "President", 1977, (.3, .6, .6, .7, .8), "liberal_democracy", "Semi-Presidential Republic"),
    "DEU": ("Friedrich Merz", "Chancellor", 1955, (.3, .7, .7, .5, .7), "conservatism", "Federal Parliamentary Republic"),
    "JPN": ("Sanae Takaichi", "Prime Minister", 1961, (.4, .6, .6, .6, .7), "conservatism", "Constitutional Monarchy"),
    "ITA": ("Giorgia Meloni", "Prime Minister", 1977, (.4, .6, .6, .6, .8), "conservatism", "Parliamentary Republic"),
    "BRA": ("Luiz Inácio Lula da Silva", "President", 1945, (.2, .6, .6, .6, .8), "social_democracy", "Federal Presidential Republic"),
    "CAN": ("Mark Carney", "Prime Minister", 1965, (.2, .7, .7, .4, .9), "liberal_democracy", "Federal Parliamentary Monarchy"),
    "TUR": ("Recep Tayyip Erdoğan", "President", 1954, (.5, .5, .4, .8, .7), "conservatism", "Presidential Republic"),
    "UKR": ("Volodymyr Zelenskyy", "President", 1978, (.4, .5, .8, .6, .7), "liberal_democracy", "Semi-Presidential Republic"),
    "ISR": ("Benjamin Netanyahu", "Prime Minister", 1949, (.7, .4, .4, .8, .7), "conservatism", "Parliamentary Republic"),
    "KOR": ("Lee Jae-myung", "President", 1963, (.3, .6, .6, .6, .7), "liberal_democracy", "Presidential Republic"),
    "AUS": ("Anthony Albanese", "Prime Minister", 1963, (.2, .7, .7, .4, .8), "social_democracy", "Federal Parliamentary Monarchy"),
    "MEX": ("Claudia Sheinbaum", "President", 1962, (.2, .6, .7, .5, .7), "social_democracy", "Federal Presidential Republic"),
    "IDN": ("Prabowo Subianto", "President", 1951, (.5, .5, .5, .7, .6), "conservatism", "Presidential Republic"),
    "SAU": ("Mohammed bin Salman", "Crown Prince and Prime Minister", 1985, (.5, .5, .4, .9, .7), "absolute_monarchy", "Absolute Monarchy"),
    "ARG": ("Javier Milei", "President", 1970, (.3, .4, .6, .7, .5), "liberal_democracy", "Federal Presidential Republic"),
    "POL": ("Donald Tusk", "Prime Minister", 1957, (.3, .7, .7, .5, .8), "liberal_democracy", "Parliamentary Republic"),
    "ESP": ("Pedro Sánchez", "Prime Minister", 1972, (.2, .6, .6, .6, .8), "social_democracy", "Constitutional Monarchy"),
    "ZAF": ("Cyril Ramaphosa", "President", 1952, (.2, .7, .6, .4, .8), "social_democracy", "Parliamentary Republic"),
    "NGA": ("Bola Tinubu", "President", 1952, (.3, .5, .5, .6, .7), "conservatism", "Federal Presidential Republic"),
    "EGY": ("Abdel Fattah el-Sisi", "President", 1954, (.4, .7, .4, .6, .7), "military_junta", "Presidential Republic (military-backed)"),
    "PAK": ("Shehbaz Sharif", "Prime Minister", 1951, (.4, .6, .5, .5, .7), "conservatism", "Federal Parliamentary Republic"),
    "IRN": ("Ali Khamenei", "Supreme Leader", 1939, (.6, .6, .5, .7, .6), "theocracy", "Islamic Republic"),
    "PRK": ("Kim Jong Un", "Supreme Leader", 1984, (.8, .4, .2, .8, .5), "communism", "Hereditary Single-Party State"),
}
MIL_2026 = {"USA": (1330, 4000, 13000), "CHN": (2035, 2600, 3300), "IND": (1460, 900, 2200), "RUS": (1300, 1300, 4200),
            "PRK": (1280, 200, 900), "KOR": (500, 400, 1600), "PAK": (650, 150, 1400), "IRN": (610, 150, 500),
            "UKR": (900, 30, 300), "VNM": (480, 100, 400), "EGY": (440, 250, 1100), "TUR": (355, 350, 1050),
            "IDN": (400, 300, 450), "BRA": (360, 250, 650), "FRA": (200, 450, 1000), "GBR": (145, 500, 650),
            "JPN": (247, 700, 1450), "DEU": (180, 150, 600), "ITA": (165, 350, 800), "ISR": (170, 80, 600),
            "SAU": (257, 120, 900), "POL": (200, 50, 450), "THA": (360, 150, 550)}


def list_scenarios() -> list[dict]:
    return list(SCENARIOS.values())


def _parse(rows: str) -> list[dict]:
    out = []
    for line in rows.strip().splitlines():
        f = line.split("|")
        out.append(dict(tag=f[0], name=f[1], adj=f[2], color=f[3], gov=f[4], ideo=f[5], leader=f[6], title=f[7],
                        born=int(f[8]), traits=dict(zip(("agg", "cau", "hon", "amb", "prag"), map(float, f[9].split(",")))),
                        owns=f[10].split(), gdppc=float(f[11]), stab=float(f[12]), army=float(f[13]), navy=float(f[14]),
                        air=float(f[15]), subject=f[16] if len(f) > 16 and f[16] else None))
    return out


def _region_key(geo, code: str, table: dict) -> float:
    c = geo.countries.get(code, {})
    if c.get("subregion") == "Western Asia" and "Western Asia" in table:
        return table["Western Asia"]
    return table.get(c.get("continent", "Asia"), 800)


def _pop_factor(geo, code: str, year: int) -> float:
    cont = geo.countries.get(code, {}).get("continent", "Asia")
    if year >= 2020:
        return 1.0
    keys = sorted(POPFACTOR)
    if year <= keys[0]:
        return POPFACTOR[keys[0]].get(cont, 0.3)
    for a, b in zip(keys, keys[1:]):
        if a <= year <= b:
            t = (year - a) / (b - a)
            return POPFACTOR[a].get(cont, .3) * (1 - t) + POPFACTOR[b].get(cont, .3) * t
    t = (year - keys[-1]) / (2020 - keys[-1])
    return POPFACTOR[keys[-1]].get(cont, .4) * (1 - t) + t


def new_state(seed: int, year: int, month: int, scenario: dict, settings: dict) -> dict:
    ideologies = {k: dict(v) for k, v in BASE.items()}
    for iid, (nm, fam, e, a, p, c, s, desc, sup, opp, eco) in D.EXTRA_IDEOLOGIES.items():
        ideologies[iid] = dict(id=iid, name=nm, family=fam, axes=dict(econ=e, auth=a, prog=p, central=c, substrate=s), desc=desc,
                               supporters=sup, opponents=opp, economy=eco, origin=None, founder=None, custom=False)
    return {
        "meta": {"seed": seed, "year": year, "month": month, "start_year": year, "start_month": month,
                 "scenario": scenario["id"], "scenario_name": scenario["name"], "player": None, "tick": 0,
                 "era": None, "period": None, "settings": settings, "divergence": settings.get("divergence") or "",
                 "next_id": 1, "phase": None, "phase_since": year, "last_summary_decade": (year // 10) * 10},
        "countries": {}, "provinces": {}, "relations": {}, "treaties": [], "wars": [], "orgs": {},
        "ideologies": ideologies, "threads": {}, "missions": {}, "decisions": [], "bodies": {},
        "gen_techs": {}, "milestones": [], "history": {}, "hooks": [], "pending_events": [], "intel": {},
    }


def next_id(state: dict, prefix: str) -> str:
    n = state["meta"]["next_id"]
    state["meta"]["next_id"] = n + 1
    return f"{prefix}{n}"


def _init_provinces(state: dict, year: int, owner_of_code: dict, overrides: list, pop_override: dict,
                    gdppc_of: dict, metro_culture: dict, regional: dict) -> None:
    geo = get_geo()
    by_name = {(p["name"], p["country"]): pid for pid, p in geo.provinces.items()}
    owner = {}
    for pid, p in geo.provinces.items():
        owner[pid] = owner_of_code.get(p["country"])
    for nm, code, tag in overrides:
        pid = by_name.get((nm, code))
        if pid:
            owner[pid] = tag
    for pid, p in geo.provinces.items():
        code = p["country"]
        modern_pop = geo.countries.get(code, {}).get("pop", 0) / 1e6
        total = pop_override.get(code, modern_pop * _pop_factor(geo, code, year))
        o = owner[pid]
        if o and (CULTURE_OF.get(code) == metro_culture.get(o) or code in state["countries"].get(o, {}).get("_integral", [])):
            gpc = gdppc_of[o]
        else:
            gpc = _region_key(geo, code, regional) * GK
        state["provinces"][pid] = {
            "owner": o, "ctrl": o, "pop": round(total * p["w"], 4), "gpc": gpc, "base": gpc, "unrest": 0.0,
            "integ": 100.0 if o and CULTURE_OF.get(code) == metro_culture.get(o) else 40.0,
            "culture": CULTURE_OF.get(code, "other"), "code": code, "cores": [o] if o and CULTURE_OF.get(code) == metro_culture.get(o) else [],
            "body": "earth", "dev": 1.0, "autonomy": 0,
        }


def build_historical(sid: str, seed: int, settings: dict) -> dict:
    geo = get_geo()
    sc = SCENARIOS[sid]
    year, month = sc["year"], sc["month"]
    state = new_state(seed, year, month, sc, settings)
    if sid == "2026":
        return _build_2026(state)
    rows = _parse(getattr(D, f"S{sid}"))
    regional = REGIONAL[int(sid)]
    top = max(r["gdppc"] for r in rows)
    owner_of_code, gdppc_of, metro_culture = {}, {}, {}
    rng = rng_for(seed, "scenario")
    for r in rows:
        for code in r["owns"]:
            owner_of_code[code] = r["tag"]
        dev = clamp((r["gdppc"] / top) ** 0.55, 0.15, 1)
        techs = initial_techs(year, dev)
        metro = r["owns"][0] if r["owns"] else None
        culture = CULTURE_OF.get(metro, "other") if metro else {"TIB": "east_asian", "MAN": "east_asian", "CCP": "east_asian", "GDR": "germanic"}.get(r["tag"], "other")
        metro_culture[r["tag"]] = culture
        gdppc_of[r["tag"]] = r["gdppc"] * GK
        leader = make_leader(rng, culture, year, r["title"], r["leader"], r["born"], r["traits"])
        leader["since"] = year - rng.randint(0, 6)
        mil = 0.03
        if r["ideo"] in ("national_socialism", "fascism", "militarist_statism", "communism") or r["tag"] in ("SOV", "USA") and sid == "1962":
            mil = 0.09 if sid != "1962" else 0.08
        res = {"1914": 0.008, "1936": 0.012, "1962": 0.025}[sid]
        cap = geo.countries.get(metro, {}).get("capital") if metro else None
        c = make_country(r["tag"], r["name"], r["adj"], color=r["color"], gov=r["gov"], ideology=r["ideo"], leader=leader,
                         capital=cap, culture=culture, year=year, techs=techs, stability=r["stab"], army=r["army"],
                         navy=r["navy"], air=r["air"], budget={"military": mil, "research": res, "infra": 0.02, "welfare": 0.02},
                         ideology_reg=state["ideologies"])
        c["founded"] = None
        c["origin"] = getattr(D, f"BACK{sid}").get(r["tag"], "")
        c["overlord"] = r["subject"]
        c["_integral"] = [code for code in r["owns"] if r["tag"] in ("SOV", "YUG", "CZS", "RUS", "USA", "CHN")]
        c["treasury"] = 0.0
        if r["tag"] in ("GER", "SOV", "JPN", "ITA") and sid == "1936" or r["tag"] in ("USA", "SOV") and sid == "1962":
            c["mil_mix"] = {"army": 0.6, "navy": 0.15, "air": 0.25, "space": 0.0}
        if sid == "1962" and r["tag"] in ("USA", "SOV"):
            c["nukes"] = 25000 if r["tag"] == "USA" else 3300
        if sid == "1962" and r["tag"] in ("GBR", "FRA"):
            c["nukes"] = 300 if r["tag"] == "GBR" else 50
        state["countries"][r["tag"]] = c
    _init_provinces(state, year, owner_of_code, getattr(D, f"OVR{sid}"), getattr(D, f"POP{sid}", {}), gdppc_of, metro_culture, regional)
    # special capitals for states without a metropolitan modern code
    by_name = {(p["name"], p["country"]): pid for pid, p in geo.provinces.items()}
    special = {"TIB": ("Xizang", "CHN"), "MAN": ("Jilin", "CHN"), "CCP": ("Shaanxi", "CHN"), "GDR": ("Sachsen", "DEU")}
    for tag, key in special.items():
        if tag in state["countries"] and key in by_name:
            state["countries"][tag]["capital"] = by_name[key]
    if sid == "1962" and ("Berlin", "DEU") in by_name:
        bp = by_name[("Berlin", "DEU")]
        state["provinces"][bp]["owner"] = state["provinces"][bp]["ctrl"] = "GDR"
        state["countries"]["GDR"]["capital"] = bp
        alt = [pid for pid, p in state["provinces"].items() if p["owner"] == "FRG"]
        state["countries"]["FRG"]["capital"] = max(alt, key=lambda x: state["provinces"][x]["pop"])
    for tag, key in special.items():
        if tag in state["countries"]:
            for pid, p in state["provinces"].items():
                if p["owner"] == tag:
                    p["gpc"] = p["base"] = gdppc_of[tag]
                    p["cores"] = [tag] + ([x for x in p["cores"] if x != tag])
                    p["integ"] = 100.0
    _spawn_unclaimed(state, year, rng)
    _apply_common(state, sid, year)
    return state


def _spawn_unclaimed(state: dict, year: int, rng: random.Random) -> None:
    """Give any inhabited territory not covered by the scenario tables its own minor state."""
    geo = get_geo()
    groups: dict[str, list[str]] = {}
    for pid, p in state["provinces"].items():
        if p["owner"] is None and p["code"] not in ("ATA", "ATF", "HMD", "SGS", "IOA", "FLK") and p["pop"] > 0.001:
            groups.setdefault(p["code"], []).append(pid)
    for code, pids in groups.items():
        info = geo.countries.get(code, {"name": code})
        tag = code if code not in state["countries"] else code[:2] + "X"
        culture = CULTURE_OF.get(code, "other")
        reg = REGIONAL.get(min(REGIONAL, key=lambda y: abs(y - year)), {})
        gpc = _region_key(geo, code, reg) * GK if reg else 2000
        c = make_country(tag, info["name"], adjective(info["name"]), color=color_for(rng), gov=None, ideology="conservatism",
                         leader=make_leader(rng, culture, year), capital=info.get("capital") if info.get("capital") in pids else pids[0],
                         culture=culture, year=year, techs=initial_techs(year, 0.35), stability=55, army=5)
        c["founded"] = None
        state["countries"][tag] = c
        for pid in pids:
            pr = state["provinces"][pid]
            pr.update(owner=tag, ctrl=tag, cores=[tag], integ=100.0, gpc=gpc, base=gpc)


def _apply_common(state: dict, sid: str, year: int) -> None:
    from ..sim.relations import set_opinion
    geo = get_geo()
    by_name = {(p["name"], p["country"]): pid for pid, p in geo.provinces.items()}
    for mem in getattr(D, f"MEM{sid}", []):
        a, b, y, kind, w, text = mem
        if a in state["countries"] and b in state["countries"]:
            state["countries"][a]["memories"].append({"y": y, "other": b, "kind": kind, "w": w, "text": text, "hist": True})
    for tag, claims in getattr(D, f"CLAIMS{sid}", {}).items():
        if tag not in state["countries"]:
            continue
        for cl in claims:
            if isinstance(cl, tuple):
                pid = by_name.get(cl)
                pids = [pid] if pid else []
            else:
                pids = geo.by_modern.get(cl, [])
            for pid in pids:
                if pid and state["provinces"][pid]["owner"] != tag:
                    state["countries"][tag]["claims"][pid] = year - 10
                    if tag not in state["provinces"][pid]["cores"]:
                        state["provinces"][pid]["cores"].append(tag)
    for oid, name, kind, founded, members, desc in getattr(D, f"ORGS{sid}", []):
        state["orgs"][oid] = {"id": oid, "name": name, "kind": kind, "founded": founded, "desc": desc,
                              "members": [m for m in members.split() if m in state["countries"]], "leader": None}
    for kind, members, y, name in getattr(D, f"TREATIES{sid}", []):
        if all(m in state["countries"] for m in members):
            state["treaties"].append({"id": next_id(state, "t"), "type": kind, "members": list(members), "since": y, "name": name, "secret": False})
    from ..sim.war import start_war
    for name, att, de, y, goal, score in getattr(D, f"WARS{sid}", []):
        if all(t in state["countries"] for t in att + de):
            w = start_war(state, att[0], de[0], goal, name=name, silent=True)
            w["start"] = y
            w["score"] = score
            if name.startswith("Second Italo"):
                # Italian armies already hold the northern provinces
                eth = [pid for pid, p in state["provinces"].items() if p["owner"] == "ETH"]
                eth.sort(key=lambda pid: -geo.provinces[pid]["c"][1])
                for pid in eth[: len(eth) // 2]:
                    state["provinces"][pid]["ctrl"] = "ITA"
    for i, (y, m, hid, title, tag, desc) in enumerate(getattr(D, f"HOOKS{sid}", [])):
        state["hooks"].append({"y": y, "m": m, "id": hid, "title": title, "tag": tag, "desc": desc, "done": False})
    for tag, c in state["countries"].items():
        c.pop("_integral", None)
    # initial opinions: ideology similarity + memories + treaties
    from ..sim.relations import recompute_opinions
    recompute_opinions(state, initial=True)
    state["meta"]["world_background"] = getattr(D, f"BACK{sid}", {}).get("_world", "")


def _build_2026(state: dict) -> dict:
    geo = get_geo()
    rng = rng_for(state["meta"]["seed"], "scenario2026")
    name_to_code = {}
    for code, c in geo.countries.items():
        if c["name"] == c["sovereign"]:
            name_to_code[c["sovereign"]] = code
    for code, c in geo.countries.items():
        if c["type"] in ("Sovereign country", "Sovereignty") and c["sovereign"] not in name_to_code:
            name_to_code[c["sovereign"]] = code
    sov_of = {}
    for code, c in geo.countries.items():
        s = name_to_code.get(c["sovereign"], code)
        sov_of[code] = s
    for special, s in {"KOS": "KOS", "SOL": "SOL", "SAH": "MAR", "CYN": "CYN", "KAS": "IND", "PSX": "PSX", "TWN": "TWN", "ATA": None}.items():
        sov_of[special] = s
    sovereigns = sorted({s for s in sov_of.values() if s})
    top = 70000
    owner_of_code, gdppc_of, metro_culture = {}, {}, {}
    for code in sovereigns:
        info = geo.countries.get(code)
        if not info:
            continue
        gpc = (info["gdp_md"] * 1e6) / max(1, info["pop"]) if info["pop"] else 5000
        gpc = max(600.0, gpc) * 1.15  # nominal -> rough PPP adjustment
        culture = CULTURE_OF.get(code, "other")
        metro_culture[code] = culture
        gdppc_of[code] = gpc
        dev = clamp((gpc / top) ** 0.45, 0.25, 1)
        lead = LEADERS_2026.get(code)
        if lead:
            nm, title, born, tr, ideo, gov = lead
            leader = make_leader(rng, culture, 2026, title, nm, born, dict(zip(("agg", "cau", "hon", "amb", "prag"), tr)))
        else:
            ideo, gov = _default_2026_ideology(code, info)
            leader = make_leader(rng, culture, 2026, "Head of Government")
        army, navy, air = MIL_2026.get(code, (max(1.0, info["pop"] / 1e6 * 2.5), info["pop"] / 1e6 * 0.5, info["pop"] / 1e6 * 1.0))
        c = make_country(code, info["name"], adjective(info["name"]), color=_modern_color(code, rng), gov=gov, ideology=ideo,
                         leader=leader, capital=info.get("capital"), culture=culture, year=2026,
                         techs=initial_techs(2026, dev), stability=65, army=army, navy=navy, air=air,
                         budget={"military": 0.02, "research": 0.022, "infra": 0.03, "welfare": 0.05}, ideology_reg=state["ideologies"])
        c["founded"] = None
        state["countries"][code] = c
        for m, s in sov_of.items():
            if s == code:
                owner_of_code[m] = code
    for code, nuk in {"USA": 5200, "RUS": 5500, "CHN": 600, "FRA": 290, "GBR": 225, "IND": 170, "PAK": 170, "ISR": 90, "PRK": 50}.items():
        if code in state["countries"]:
            state["countries"][code]["nukes"] = nuk
    for code in ("USA", "CHN", "RUS"):
        state["countries"][code]["budget"]["military"] = 0.035
    _init_provinces(state, 2026, owner_of_code, [], {}, gdppc_of, metro_culture, {})
    for pid, p in state["provinces"].items():
        if p["owner"]:
            p["cores"] = [p["owner"]] if not p["cores"] else p["cores"]
            p["integ"] = 100.0 if CULTURE_OF.get(p["code"]) == metro_culture.get(p["owner"]) else 75.0
    orgs = [
        ("un", "United Nations", "international", 1945, " ".join(t for t in state["countries"] if t not in ("TWN", "KOS", "SOL", "CYN", "PSX", "SAH")), "The universal international organisation."),
        ("nato", "NATO", "alliance", 1949, "USA CAN GBR FRA DEU ITA ESP PRT NLD BEL LUX DNK NOR ISL POL CZE SVK HUN ROU BGR GRC TUR HRV SVN ALB MNE MKD EST LVA LTU FIN SWE", "North Atlantic Treaty Organization."),
        ("eu", "European Union", "union", 1993, "FRA DEU ITA ESP PRT NLD BEL LUX DNK IRL AUT SWE FIN POL CZE SVK HUN ROU BGR GRC CYP MLT HRV SVN EST LVA LTU", "Supranational political and economic union."),
        ("brics", "BRICS", "economic", 2009, "BRA RUS IND CHN ZAF EGY ETH IRN ARE IDN", "Grouping of major emerging economies."),
        ("csto", "Collective Security Treaty Organization", "alliance", 2002, "RUS BLR KAZ KGZ TJK ARM", "Russian-led security alliance."),
        ("asean", "ASEAN", "economic", 1967, "IDN MYS PHL SGP THA BRN VNM LAO MMR KHM", "Association of Southeast Asian Nations."),
        ("au", "African Union", "international", 2002, " ".join(t for t, c in state["countries"].items() if geo.countries.get(t, {}).get("continent") == "Africa"), "Continental union of African states."),
    ]
    for oid, name, kind, founded, members, desc in orgs:
        state["orgs"][oid] = {"id": oid, "name": name, "kind": kind, "founded": founded, "desc": desc,
                              "members": [m for m in members.split() if m in state["countries"]], "leader": None}
    for a, b, nm in [("USA", "JPN", "US-Japan Security Treaty"), ("USA", "KOR", "US-ROK Mutual Defense Treaty"), ("USA", "AUS", "AUKUS"),
                     ("GBR", "AUS", "AUKUS"), ("CHN", "PRK", "Sino-North Korean Treaty"), ("RUS", "PRK", "Comprehensive Strategic Partnership"),
                     ("USA", "PHL", "Mutual Defense Treaty")]:
        state["treaties"].append({"id": next_id(state, "t"), "type": "alliance", "members": [a, b], "since": 2000, "name": nm, "secret": False})
    mems = [("UKR", "RUS", 2022, "invasion", -80, "Russia launched a full-scale invasion in February 2022."),
            ("UKR", "RUS", 2014, "territory_lost", -50, "Russia annexed Crimea in 2014."),
            ("RUS", "USA", 1991, "defeat", -20, "The Soviet collapse is remembered as a geopolitical catastrophe."),
            ("CHN", "JPN", 1937, "invasion", -45, "The Japanese invasion of China (1937-45)."),
            ("KOR", "JPN", 1910, "territory_lost", -30, "Japanese colonial rule over Korea (1910-45)."),
            ("POL", "RUS", 1939, "invasion", -30, "Soviet invasion and occupation of eastern Poland."),
            ("TWN", "CHN", 1949, "war", -40, "The Nationalists retreated to Taiwan after losing the civil war."),
            ("CHN", "TWN", 1949, "war", -20, "The civil war left Taiwan outside Beijing's control."),
            ("IND", "PAK", 1947, "war", -40, "Partition and repeated wars over Kashmir."),
            ("PAK", "IND", 1971, "defeat", -40, "The loss of East Pakistan (Bangladesh)."),
            ("IRN", "USA", 1953, "interference", -40, "The 1953 coup against Mossadegh."),
            ("USA", "IRN", 1979, "interference", -30, "The hostage crisis after the Islamic Revolution."),
            ("VNM", "USA", 1965, "war", -15, "The Vietnam War.")]
    for a, b, y, k, w, t in mems:
        if a in state["countries"] and b in state["countries"]:
            state["countries"][a]["memories"].append({"y": y, "other": b, "kind": k, "w": w, "text": t, "hist": True})
    if "CHN" in state["countries"] and "TWN" in state["countries"]:
        for pid, p in state["provinces"].items():
            if p["owner"] == "TWN":
                p["cores"].append("CHN")
                state["countries"]["CHN"]["claims"][pid] = 1949
    from ..sim.war import start_war
    if "RUS" in state["countries"] and "UKR" in state["countries"]:
        w = start_war(state, "RUS", "UKR", "conquest", name="Russo-Ukrainian War", silent=True)
        w["start"] = 2022
        for pid, p in state["provinces"].items():
            if p["code"] == "UKR":
                p["cores"] = ["UKR"]
                if get_geo().provinces[pid]["name"] in ("Donets'k",):
                    p["ctrl"] = "RUS"
                state["countries"]["RUS"]["claims"][pid] = 2014
            if get_geo().provinces[pid]["name"] == "Crimea":
                p["cores"] = ["UKR", "RUS"]
                state["countries"]["UKR"]["claims"][pid] = 2014
    for pid, p in state["provinces"].items():
        p["ctrl"] = p["ctrl"] or p["owner"]
    state["meta"]["world_background"] = (
        "January 2026. The post-Cold War order is fraying. The United States remains the largest economy and military power, "
        "but China rivals it in industry and technology. Russia's war against Ukraine, begun in 2022, grinds on. Artificial "
        "intelligence is advancing at unprecedented speed, reusable rockets have made orbit cheap, and nations are racing to return "
        "to the Moon. Climate change, ageing populations and debt weigh on many states, while India, Indonesia and the Gulf monarchies rise.")
    from ..sim.relations import recompute_opinions
    recompute_opinions(state, initial=True)
    return state


def _default_2026_ideology(code: str, info: dict) -> tuple[str, str]:
    mon = {"SAU": "absolute_monarchy", "ARE": "absolute_monarchy", "QAT": "absolute_monarchy", "OMN": "absolute_monarchy",
           "KWT": "constitutional_monarchy", "BHR": "absolute_monarchy", "BRN": "absolute_monarchy", "SWZ": "absolute_monarchy",
           "JOR": "constitutional_monarchy", "MAR": "constitutional_monarchy", "THA": "constitutional_monarchy"}
    if code in mon:
        return mon[code], "Monarchy"
    if code in ("CUB", "VNM", "LAO"):
        return "communism", "Socialist Single-Party State"
    if code in ("MMR", "MLI", "BFA", "NER", "GIN", "SDN", "TCD", "GAB"):
        return "military_junta", "Military Government"
    if code in ("AFG",):
        return "theocracy", "Islamic Emirate"
    if code in ("BLR", "KAZ", "UZB", "TKM", "TJK", "AZE", "VEN", "NIC", "ERI", "RWA", "SYR", "DZA"):
        return "conservatism", "Presidential Republic (authoritarian)"
    if info.get("continent") in ("Europe", "North America", "South America", "Oceania"):
        return "liberal_democracy", "Republic"
    return "conservatism", "Presidential Republic"


def _modern_color(code: str, rng: random.Random) -> str:
    fixed = {"USA": "#2a4d8f", "CHN": "#c9a227", "RUS": "#3d7a3d", "IND": "#f39c12", "GBR": "#c0392b", "FRA": "#3b6fd8", "DEU": "#5b5b5b",
             "JPN": "#e0a3a3", "BRA": "#229954", "CAN": "#e74c3c", "AUS": "#16a085", "ITA": "#3a9d5d", "TUR": "#b03a2e", "IRN": "#239b56"}
    return fixed.get(code) or "#%06x" % (stable_hash(code) & 0xBFBFBF | 0x303030)


# ---------------------------------------------------------------------------
# Fictional worlds


def world_population(year: int) -> float:
    """Approximate world population in millions for any year (future: logistic plateau)."""
    pts = [(-10000, 4), (-3000, 14), (-1000, 50), (1, 200), (1000, 300), (1500, 450), (1800, 990), (1900, 1650),
           (1950, 2500), (2000, 6100), (2026, 8200), (2100, 10200)]
    if year <= pts[0][0]:
        return pts[0][1]
    for (a, pa), (b, pb) in zip(pts, pts[1:]):
        if a <= year <= b:
            t = (year - a) / (b - a)
            return math.exp(math.log(pa) * (1 - t) + math.log(pb) * t)
    return 10200 + 1500 * (1 - math.exp(-(year - 2100) / 400))


def world_gdppc(year: int) -> float:
    pts = [(-10000, 400), (1, 700), (1500, 900), (1800, 1300), (1900, 3500), (1950, 4500), (2000, 12000), (2026, 18000)]
    if year <= pts[0][0]:
        return pts[0][1]
    for (a, pa), (b, pb) in zip(pts, pts[1:]):
        if a <= year <= b:
            t = (year - a) / (b - a)
            return pa * (1 - t) + pb * t
    return 18000 * (1.012 ** min(400, year - 2026))


def era_family_pool(year: int) -> list[tuple[str, float]]:
    if year < 500:
        return [("absolute_monarchy", 4), ("tribal_confederation", 4), ("theocracy", 2), ("city_state_republic", 1)]
    if year < 1700:
        return [("absolute_monarchy", 5), ("feudal", 0), ("theocracy", 2), ("tribal_confederation", 2), ("city_state_republic", 1.5), ("imperial_federalism", 1)]
    if year < 1900:
        return [("absolute_monarchy", 3), ("constitutional_monarchy", 3), ("liberal_democracy", 1.5), ("imperial_federalism", 1), ("conservatism", 1)]
    if year < 2050:
        return [("liberal_democracy", 4), ("social_democracy", 2), ("conservatism", 2), ("communism", 1), ("military_junta", 1.5), ("constitutional_monarchy", 1), ("theocracy", 0.5)]
    return [("liberal_democracy", 2), ("technocracy", 3), ("corporatocracy", 1.5), ("planetarism", 1), ("algorithmic_governance", 1.5),
            ("substrate_egalitarianism", 1), ("social_democracy", 1.5), ("bio_conservatism", 1)]


def build_fictional(seed: int, year: int, settings: dict) -> dict:
    """Generate a coherent fictional world on real geography: realms grown from population centres,
    a generated deep history (fallen empires, wars, founding myths) and era-appropriate technology."""
    geo = get_geo()
    sc = dict(SCENARIOS["fictional"])
    sc["name"] = settings.get("scenario_title") or f"A World Unwritten ({year})"
    state = new_state(seed, year, 1, sc, settings)
    rng = rng_for(seed, "fictional", year)
    pids = [pid for pid in geo.provinces if geo.provinces[pid]["country"] not in ("ATA", "ATF", "HMD", "SGS")]
    n_realms = int(settings.get("realms") or clamp(40 + (year > 1500) * 30, 30, 90))
    weights = {pid: geo.countries.get(geo.provinces[pid]["country"], {}).get("pop", 1e5) * geo.provinces[pid]["w"] + 1e5 for pid in pids}
    seeds_ = []
    pool = list(pids)
    while len(seeds_) < n_realms and pool:
        pick = rng.choices(pool, weights=[weights[p] for p in pool])[0]
        if all(geo.distance(pick, s) > 500 for s in seeds_):
            seeds_.append(pick)
        pool.remove(pick)
    owner: dict[str, str] = {}
    frontier = []
    tags = []
    for i, s in enumerate(seeds_):
        tag = f"R{i:02d}"
        tags.append(tag)
        owner[s] = tag
        frontier.append((0.0, rng.random(), s, tag))
    import heapq
    heapq.heapify(frontier)
    strength = {t: 0.6 + rng.random() * 1.2 for t in tags}
    while frontier:
        cost, _, pid, tag = heapq.heappop(frontier)
        for nb in geo.neighbors(pid) + geo.sea_links(pid)[:1]:
            if nb in owner or nb not in geo.provinces or nb not in pids:
                continue
            owner[nb] = tag
            step = geo.distance(pid, nb) / strength[tag] * (3 if nb in geo.sea_links(pid) else 1)
            heapq.heappush(frontier, (cost + step, rng.random(), nb, tag))
    # remaining unreached provinces (isolated islands) join the nearest realm; only large ones found their own
    for pid in pids:
        if pid in owner:
            continue
        near = min((q for q in owner), key=lambda q: geo.distance(pid, q), default=None)
        if near and (geo.distance(pid, near) < 1500 or weights[pid] < 3e6):
            owner[pid] = owner[near]
        else:
            tag = f"R{len(tags):02d}"
            tags.append(tag)
            owner[pid] = tag
    world_pop = world_population(year)
    total_w = sum(weights[p] for p in pids)
    gpc_base = world_gdppc(year)
    flavor = "default"
    realm_cultures: dict[str, str] = {}
    for tag in tags:
        mine = [p for p in pids if owner[p] == tag]
        cult = max(set(CULTURE_OF.get(geo.provinces[p]["country"], "other") for p in mine),
                   key=lambda c: sum(weights[p] for p in mine if CULTURE_OF.get(geo.provinces[p]["country"], "other") == c))
        realm_cultures[tag] = cult
        root = realm_root(rng, flavor)
        pool_ = era_family_pool(year)
        ideo = rng.choices([i for i, _ in pool_], weights=[w for _, w in pool_])[0]
        if ideo not in state["ideologies"]:
            ideo = "absolute_monarchy"
        fam = state["ideologies"][ideo]["family"]
        name = state_name(rng, fam, root)
        dev = clamp(0.35 + rng.random() * 0.65, 0, 1)
        cap = max(mine, key=lambda p: weights[p])
        leader = make_leader(rng, cult, year, {"monarchic": "Sovereign", "traditional": "High Chief", "religious": "High Priest",
                                               "imperial": "Emperor"}.get(fam, "Head of State"))
        c = make_country(tag, name, adjective(root), color=color_for(rng), gov=FAMILY_GOV.get(fam), ideology=ideo, leader=leader,
                         capital=cap, culture=cult, year=year, techs=initial_techs(year, dev), stability=40 + rng.random() * 40,
                         ideology_reg=state["ideologies"],
                         budget={"military": 0.04, "research": 0.004 if year < 1800 else 0.015, "infra": 0.02, "welfare": 0.02})
        c["founded"] = year - rng.randint(20, 600)
        c["_dev"] = dev
        c["_root"] = root
        state["countries"][tag] = c
    for pid in pids:
        tag = owner[pid]
        dev = state["countries"][tag]["_dev"]
        p = geo.provinces[pid]
        gpc = gpc_base * (0.5 + dev)
        state["provinces"][pid] = {"owner": tag, "ctrl": tag, "pop": round(world_pop * weights[pid] / total_w, 4), "gpc": gpc, "base": gpc,
                                   "unrest": 0.0, "integ": 100.0, "culture": p["culture"], "code": p["country"], "cores": [tag],
                                   "body": "earth", "dev": 1.0, "autonomy": 0}
    for pid in geo.provinces:
        if pid not in state["provinces"]:
            p = geo.provinces[pid]
            state["provinces"][pid] = {"owner": None, "ctrl": None, "pop": 0.0, "gpc": 0, "base": 0, "unrest": 0, "integ": 0,
                                       "culture": p["culture"], "code": p["country"], "cores": [], "body": "earth", "dev": 1.0, "autonomy": 0}
    # militaries proportional to population
    for tag, c in state["countries"].items():
        pop = sum(p["pop"] for p in state["provinces"].values() if p["owner"] == tag)
        c["army"] = round(pop * 1000 * 0.008, 1)
        c["navy"] = round(pop * 0.2 * rng.random(), 1)
        c["air"] = round(pop * 2 * rng.random(), 1) if year > 1920 else 0.0
    _fictional_history(state, rng, year, owner)
    for c in state["countries"].values():
        c.pop("_dev", None)
        c.pop("_root", None)
    from ..sim.relations import recompute_opinions
    recompute_opinions(state, initial=True)
    return state


def _fictional_history(state: dict, rng: random.Random, year: int, owner: dict) -> None:
    """Invent a deep, consistent past: a fallen empire, wars between neighbours, founding stories."""
    geo = get_geo()
    tags = list(state["countries"])
    neighbors: dict[str, set] = {t: set() for t in tags}
    for pid, t in owner.items():
        for nb in geo.neighbors(pid):
            o = owner.get(nb)
            if o and o != t:
                neighbors[t].add(o)
    hist = []
    # 1. a fallen empire that once united a large group of realms
    big = max(tags, key=lambda t: len(neighbors[t]))
    members = [big] + rng.sample(sorted(neighbors[big]), min(len(neighbors[big]), rng.randint(3, 6)))
    root = realm_root(rng)
    empire = f"{root} Empire"
    span = max(60, int(rng.uniform(0.15, 0.4) * max(300, min(2000, year + 3000))))
    fell = year - rng.randint(60, 400)
    rose = fell - span
    hist.append((rose, "founding", f"Rise of the {empire}", f"The {empire} united the lands of {', '.join(state['countries'][m]['name'] for m in members)} under a single throne.", members))
    hist.append((fell, "collapse", f"Fall of the {empire}", f"Succession wars and provincial revolts shattered the {empire}; its provinces became the realms of today, each claiming its legacy.", members))
    for m in members:
        c = state["countries"][m]
        c["heritage"].append({"name": empire, "rose": rose, "fell": fell})
        c["origin"] = f"Founded c. {c['founded'] if c['founded'] > fell else fell + rng.randint(1, 40)} from the ruins of the {empire}."
        c["founded"] = max(c["founded"], fell + rng.randint(1, 40))
    state["meta"]["fallen_empires"] = [{"name": empire, "rose": rose, "fell": fell, "members": members}]
    # 2. wars between neighbours, leaving grievances and claims
    for _ in range(min(25, len(tags))):
        a = rng.choice(tags)
        if not neighbors[a]:
            continue
        b = rng.choice(sorted(neighbors[a]))
        y = year - rng.randint(5, 250)
        winner, loser = (a, b) if rng.random() < 0.5 else (b, a)
        lost = [pid for pid, t in owner.items() if t == winner and any(owner.get(n) == loser for n in geo.neighbors(pid))]
        wname = f"{state['countries'][winner]['adj']}-{state['countries'][loser]['adj']} War of {y if y > 0 else str(-y) + ' BCE'}"
        text = f"{state['countries'][winner]['name']} defeated {state['countries'][loser]['name']}"
        if lost:
            pid = rng.choice(lost)
            text += f" and annexed {geo.name(pid)}, which {state['countries'][loser]['name']} still claims"
            state["countries"][loser]["claims"][pid] = y
            if loser not in state["provinces"][pid]["cores"]:
                state["provinces"][pid]["cores"].append(loser)
            state["provinces"][pid]["integ"] = 70.0
        hist.append((y, "war", wname, text + ".", [winner, loser]))
        state["countries"][loser]["memories"].append({"y": y, "other": winner, "kind": "defeat", "w": -35, "text": text + ".", "hist": True})
        state["countries"][winner]["memories"].append({"y": y, "other": loser, "kind": "victory", "w": -8, "text": f"Victory over {state['countries'][loser]['name']}.", "hist": True})
    # 3. alliances of old
    for _ in range(min(10, len(tags) // 4)):
        a = rng.choice(tags)
        if not neighbors[a]:
            continue
        b = rng.choice(sorted(neighbors[a]))
        y = year - rng.randint(5, 80)
        state["treaties"].append({"id": next_id(state, "t"), "type": "alliance", "members": [a, b], "since": y,
                                  "name": f"Pact of {geo.name(state['countries'][a]['capital'])}", "secret": False})
        for x, z in ((a, b), (b, a)):
            state["countries"][x]["memories"].append({"y": y, "other": z, "kind": "treaty", "w": 20, "text": f"Alliance with {state['countries'][z]['name']}.", "hist": True})
    hist.sort()
    state["meta"]["backstory_events"] = [{"y": y, "kind": k, "title": t, "text": tx, "actors": act} for y, k, t, tx, act in hist]
    big3 = sorted(tags, key=lambda t: -sum(1 for o in owner.values() if o == t))[:3]
    state["meta"]["world_background"] = (
        f"The year is {year if year > 0 else str(-year) + ' BCE'}. Centuries ago the {empire} bound much of the known world together; "
        f"its fall in {fell if fell > 0 else str(-fell) + ' BCE'} scattered its provinces into rival successor realms that still argue over its legacy. "
        f"Today the greatest powers are {', '.join(state['countries'][t]['name'] for t in big3)}. Old wars have left unhealed grievances along many borders.")
