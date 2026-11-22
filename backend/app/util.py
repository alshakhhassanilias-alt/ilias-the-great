"""Small shared helpers."""
from __future__ import annotations

import hashlib
import math
import random
from typing import Iterable


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def rng_for(seed: int, *parts) -> random.Random:
    """Deterministic RNG derived from the campaign seed plus arbitrary context."""
    h = hashlib.sha256((str(seed) + "|" + "|".join(map(str, parts))).encode()).hexdigest()
    return random.Random(int(h[:16], 16))


def stable_hash(*parts) -> int:
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def pair_key(a: str, b: str) -> str:
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def fmt_money(billions: float) -> str:
    if billions >= 1e6:
        return f"${billions / 1e6:,.2f} quadrillion"
    if billions >= 1e3:
        return f"${billions / 1e3:,.2f} trillion"
    if billions >= 1:
        return f"${billions:,.1f} billion"
    return f"${billions * 1000:,.0f} million"


def fmt_pop(millions: float) -> str:
    if millions >= 1000:
        return f"{millions / 1000:,.2f} billion"
    if millions >= 1:
        return f"{millions:,.1f} million"
    return f"{millions * 1000:,.0f} thousand"


def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def year_str(y: int) -> str:
    return f"{-y} BCE" if y < 0 else (f"{y} CE" if y < 1000 else str(y))


def join_names(names: Iterable[str]) -> str:
    names = list(names)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def weighted_choice(rng: random.Random, items: list, weights: list[float]):
    tot = sum(max(0.0, w) for w in weights)
    if tot <= 0:
        return rng.choice(items)
    r = rng.random() * tot
    for it, w in zip(items, weights):
        r -= max(0.0, w)
        if r <= 0:
            return it
    return items[-1]


def haversine(a: tuple[float, float], b: tuple[float, float], radius: float = 6371.0) -> float:
    lo1, la1, lo2, la2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return radius * 2 * math.asin(min(1.0, math.sqrt(h)))
