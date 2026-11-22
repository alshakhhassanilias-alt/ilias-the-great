"""Geographic index: Earth provinces from Natural Earth data plus extraterrestrial bodies."""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from ..util import haversine

DATA = Path(__file__).resolve().parent.parent / "data"

# Culture groups for modern country codes (used for names, cultural distance, successor states).
CULTURE = {
    "germanic": "DEU AUT CHE LIE LUX",
    "anglo": "GBR IRL USA CAN AUS NZL",
    "french": "FRA BEL MCO",
    "dutch": "NLD",
    "nordic": "SWE NOR DNK FIN ISL GRL FRO ALD",
    "italian": "ITA SMR VAT MLT",
    "iberian": "ESP PRT AND GIB",
    "slavic_w": "POL CZE SVK",
    "slavic_e": "RUS UKR BLR",
    "slavic_s": "SRB HRV SVN BIH MNE MKD BGR KOS",
    "baltic": "EST LVA LTU",
    "balkan": "ROU MDA HUN ALB GRC CYP N.CYP CYN",
    "turkic": "TUR AZE KAZ UZB TKM KGZ",
    "caucasian": "GEO ARM",
    "persian": "IRN AFG TJK",
    "arab": "SAU YEM OMN ARE QAT BHR KWT IRQ SYR JOR LBN ISR PSE EGY LBY TUN DZA MAR SAH ESH SDN MRT",
    "south_asian": "IND PAK BGD NPL BTN LKA MDV",
    "east_asian": "CHN TWN MNG HKG MAC",
    "japanese": "JPN",
    "korean": "KOR PRK",
    "se_asian": "VNM LAO KHM THA MMR MYS SGP IDN PHL BRN TLS",
    "latin": "MEX GTM HND SLV NIC CRI PAN CUB DOM HTI PRI COL VEN ECU PER BOL CHL ARG URY PRY BRA",
    "caribbean": "JAM TTO BHS BRB GUY SUR BLZ ATG DMA GRD KNA LCA VCT CUW ABW SXM MAF BLM TCA CYM VGB VIR AIA MSR BMU",
    "west_african": "NGA GHA CIV SEN MLI BFA NER GIN SLE LBR TGO BEN GMB GNB CPV",
    "central_african": "CMR TCD CAF COG COD GAB GNQ STP AGO",
    "east_african": "ETH ERI SOM SOL DJI KEN UGA TZA RWA BDI SSD MDG COM SYC MUS",
    "southern_african": "ZAF NAM BWA ZWE ZMB MWI MOZ LSO SWZ",
    "oceanic": "PNG FJI SLB VUT NCL PYF WSM TON KIR FSM MHL PLW NRU TUV",
}
CULTURE_OF = {c: g for g, cs in CULTURE.items() for c in cs.split()}


class Geo:
    def __init__(self) -> None:
        raw = json.loads((DATA / "geo.json").read_text())
        self.provinces: dict[str, dict] = {p["id"]: p for p in raw["provinces"]}
        self.countries: dict[str, dict] = raw["countries"]
        self.by_modern: dict[str, list[str]] = {}
        for p in raw["provinces"]:
            self.by_modern.setdefault(p["country"], []).append(p["id"])
            p["culture"] = CULTURE_OF.get(p["country"], "other")
            p["body"] = "earth"
        self.continent = {c: d["continent"] for c, d in self.countries.items()}

    def neighbors(self, pid: str) -> list[str]:
        p = self.provinces.get(pid)
        return p["nb"] if p else []

    def sea_links(self, pid: str) -> list[str]:
        p = self.provinces.get(pid)
        return p.get("sea", []) if p else []

    def centroid(self, pid: str) -> tuple[float, float]:
        return tuple(self.provinces[pid]["c"])  # type: ignore

    def distance(self, a: str, b: str) -> float:
        return haversine(self.centroid(a), self.centroid(b))

    def name(self, pid: str) -> str:
        p = self.provinces.get(pid)
        return p["name"] if p else pid

    def find_province(self, text: str) -> str | None:
        t = text.strip().lower()
        for pid, p in self.provinces.items():
            if p["name"].lower() == t:
                return pid
        for pid, p in self.provinces.items():
            if t and t in p["name"].lower() and len(t) > 3:
                return pid
        return None


@lru_cache(maxsize=1)
def get_geo() -> Geo:
    return Geo()


# ---------------------------------------------------------------------------
# Extraterrestrial bodies. Region centres are real named features (lon, lat).
BODIES: dict[str, dict] = {
    "luna": {
        "name": "Luna", "kind": "moon", "radius": 1737, "requires": "lunar_base", "habitability": 0.15,
        "regions": [
            ("Shackleton Rim", 0, -88), ("Peary Crater", 30, 88), ("Mare Tranquillitatis", 31, 8),
            ("Mare Imbrium", -15, 33), ("Mare Serenitatis", 17, 28), ("Oceanus Procellarum", -57, 18),
            ("Mare Crisium", 59, 17), ("Tycho Highlands", -11, -43), ("Copernicus", -20, 10),
            ("Aristarchus Plateau", -47, 24), ("Mare Nubium", -17, -21), ("South Pole-Aitken Basin", 170, -53),
            ("Mare Moscoviense", 147, 27), ("Korolev Basin", -157, -4),
        ],
    },
    "mars": {
        "name": "Mars", "kind": "planet", "radius": 3390, "requires": "mars_colonization", "habitability": 0.25,
        "regions": [
            ("Tharsis", -112, 2), ("Olympus Mons", -134, 18), ("Valles Marineris", -59, -14),
            ("Hellas Planitia", 70, -42), ("Argyre Planitia", -43, -50), ("Utopia Planitia", 118, 47),
            ("Elysium Planitia", 155, 3), ("Arabia Terra", 5, 23), ("Acidalia Planitia", -22, 50),
            ("Chryse Planitia", -36, 27), ("Isidis Planitia", 88, 13), ("Syrtis Major", 70, 8),
            ("Noachis Terra", -10, -45), ("Terra Sabaea", 42, 2), ("Amazonis Planitia", -163, 24),
            ("Arcadia Planitia", -176, 47), ("Planum Boreum", 0, 86), ("Planum Australe", 160, -84),
            ("Terra Cimmeria", 145, -35), ("Jezero", 77, 18),
        ],
    },
    "belt": {
        "name": "Asteroid Belt", "kind": "belt", "radius": 470, "requires": "asteroid_mining", "habitability": 0.05,
        "regions": [
            ("Ceres", 0, 0), ("Vesta", 60, 10), ("Pallas", 120, -15), ("Hygiea", 180, 5),
            ("Psyche", -120, -5), ("Juno", -60, 15), ("Trojan Clusters", 150, 30), ("Hilda Swarm", -150, -30),
        ],
    },
    "jovian": {
        "name": "Jovian Moons", "kind": "moons", "radius": 2634, "requires": "fusion_propulsion", "habitability": 0.08,
        "regions": [
            ("Europa", -60, 0), ("Ganymede", 0, 0), ("Callisto", 60, 0), ("Io", 120, 0),
            ("Amalthea", -120, 20), ("Himalia", 180, -20),
        ],
    },
    "saturnian": {
        "name": "Saturnian Moons", "kind": "moons", "radius": 2574, "requires": "fusion_propulsion", "habitability": 0.08,
        "regions": [("Titan", 0, 0), ("Enceladus", 70, 10), ("Rhea", -70, -10), ("Iapetus", 140, 0), ("Dione", -140, 10)],
    },
    "venus": {
        "name": "Venus (Cloud Cities)", "kind": "planet", "radius": 6051, "requires": "artificial_habitats", "habitability": 0.1,
        "regions": [("Ishtar Aerostat", -20, 60), ("Aphrodite Aerostat", 100, -5), ("Maxwell Skyport", 3, 65),
                    ("Beta Regio Float", -77, 25), ("Lada Drift", 20, -50)],
    },
    "proxima": {
        "name": "Proxima Centauri b", "kind": "exoplanet", "radius": 7160, "requires": "interstellar_colonization", "habitability": 0.35,
        "regions": [("Terminator Coast", 90, 0), ("Substellar Sea", 0, 0), ("Nightside Glacier", 180, 0),
                    ("Dawn Highlands", 60, 40), ("Dusk Basin", 120, -40), ("Polar Steppe", 90, 80)],
    },
    "tau_ceti": {
        "name": "Tau Ceti e", "kind": "exoplanet", "radius": 9500, "requires": "interstellar_colonization", "habitability": 0.3,
        "regions": [("Ember Plateau", 0, 10), ("Long Ocean", 90, -20), ("Cinder Archipelago", 180, 0),
                    ("Verdant Rift", -90, 30), ("High Tundra", 30, 70)],
    },
    "trappist": {
        "name": "TRAPPIST-1 System", "kind": "system", "radius": 6000, "requires": "interstellar_colonization", "habitability": 0.4,
        "regions": [("TRAPPIST-1d", -120, 0), ("TRAPPIST-1e", -40, 0), ("TRAPPIST-1f", 40, 0), ("TRAPPIST-1g", 120, 0)],
    },
}


def body_regions(body: str) -> list[dict]:
    b = BODIES[body]
    out = []
    pts = b["regions"]
    for i, (nm, lon, lat) in enumerate(pts):
        pid = f"{body.upper()}-{i:02d}"
        d = sorted(((haversine((lon, lat), (l2, la2), b["radius"]), j) for j, (_, l2, la2) in enumerate(pts) if j != i))
        nb = [f"{body.upper()}-{j:02d}" for _, j in d[:4]]
        out.append({"id": pid, "name": nm, "c": [lon, lat], "nb": nb, "sea": [], "body": body, "area": 0, "country": body.upper(), "culture": body})
    return out


def euclid(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
