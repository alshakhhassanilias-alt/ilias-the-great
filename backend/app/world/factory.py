"""Constructors for countries, leaders and other world entities shared by scenarios and simulation."""
from __future__ import annotations

import colorsys
import random

from ..util import clamp
from .ideologies import BASE, FAMILY_GOV
from .names import person

TRAITS = ("agg", "cau", "hon", "amb", "prag")


def random_traits(rng: random.Random, bias: dict | None = None) -> dict:
    t = {k: round(clamp(rng.gauss(0.45, 0.22) + (bias or {}).get(k, 0), 0, 1), 2) for k in TRAITS}
    return t


def make_leader(rng: random.Random, culture: str, year: int, title: str = "Head of State", name: str | None = None,
                born: int | None = None, traits: dict | None = None, digital: bool = False) -> dict:
    return {
        "name": name or person(rng, "digital" if digital else culture),
        "title": title,
        "born": born if born is not None else year - rng.randint(38, 66),
        "since": year,
        "traits": traits or random_traits(rng),
        "culture": culture,
        "digital": digital,
    }


def color_for(rng: random.Random) -> str:
    h, s, v = rng.random(), 0.35 + rng.random() * 0.4, 0.55 + rng.random() * 0.35
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def make_country(tag: str, name: str, adj: str, *, color: str, gov: str | None, ideology: str, leader: dict,
                 capital: str | None, culture: str, year: int, origin: str = "", techs: set[str] | None = None,
                 stability: float = 60, army: float = 10, navy: float = 0, air: float = 0, home: str = "earth",
                 budget: dict | None = None, ideology_reg: dict | None = None) -> dict:
    fam = (ideology_reg or {}).get(ideology, BASE.get(ideology, BASE["liberal_democracy"]))["family"]
    return {
        "tag": tag, "name": name, "adj": adj, "color": color, "gov": gov or FAMILY_GOV.get(fam, "Republic"),
        "ideology": ideology, "leader": leader, "capital": capital, "culture": culture,
        "stability": float(stability), "legitimacy": 70.0, "war_support": 50.0, "exhaustion": 0.0,
        "treasury": 0.0, "debt": 0.0,
        "budget": budget or {"military": 0.03, "research": 0.015, "infra": 0.02, "welfare": 0.03},
        "army": float(army), "navy": float(navy), "air": float(air), "space": 0.0, "nukes": 0,
        "mil_mix": {"army": 0.55, "navy": 0.25, "air": 0.2, "space": 0.0},
        "techs": sorted(techs or []), "research": {"target": None, "progress": 0.0}, "focus": None,
        "policies": {"integration": "assimilate", "economy": "mixed", "digital_rights": "none", "ai_rights": "none",
                     "succession": "hereditary" if fam in ("monarchic", "imperial") else "elective", "upload": False,
                     "mobilization": "partial", "colonial": "direct"},
        "laws": [], "pops": {"dig": 0.0, "ai": 0.0, "enh": 0.0},
        "overlord": None, "alive": True, "founded": year, "fell": None, "origin": origin,
        "predecessors": [], "heritage": [], "ambitions": [], "memories": [], "claims": {},
        "ai": True, "home": home, "projects": [], "flags": {}, "gdp": 0.0, "pop": 0.0, "mods": {},
    }
