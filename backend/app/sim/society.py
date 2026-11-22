"""Post-biological society: uploaded minds, artificial persons, human enhancement and the tensions they create."""
from __future__ import annotations

import math

from ..util import clamp
from .core import emit, idx


def upload_population(state: dict, c: dict, frac: float) -> float:
    frac = clamp(frac, 0, 0.95)
    moved = 0.0
    for pid in idx(state)["owned"].get(c["tag"], []):
        p = state["provinces"][pid]
        d = p["pop"] * frac
        p["pop"] -= d
        moved += d
    c["pops"]["dig"] = c["pops"].get("dig", 0.0) + moved
    return moved


def society_tick(state: dict, dt: float) -> None:
    for t, c in state["countries"].items():
        if not c["alive"]:
            continue
        u = set(c.get("mods", {}).get("unlocks", []))
        pops = c["pops"]
        pol = c["policies"]
        if "upload" in u:
            mode = pol.get("upload")
            if mode in (None, False):
                mode = pol["upload"] = "voluntary"
            rate = {"banned": 0.0, "voluntary": 0.003, "encouraged": 0.015, "mass": 0.08}.get(mode, 0.003)
            if rate:
                upload_population(state, c, rate * dt)
            peak = c["flags"]["peak_pop"] = max(c["flags"].get("peak_pop", 0.0), c["pop"] + pops.get("dig", 0.0))
            cap = 8 * peak
            pops["dig"] = pops.get("dig", 0.0) * math.exp(0.012 * dt * max(0.0, 1 - pops.get("dig", 0.0) / max(1e-6, cap)))
        if "ai_minds" in u and pol.get("ai_rights") != "banned":
            target = c.get("gdp_bio", c["gdp"]) / 2000.0  # millions of artificial persons supported by compute
            pops["ai"] = pops.get("ai", 0.0) + (target - pops.get("ai", 0.0)) * min(1.0, 0.12 * dt)
        if "enhancement" in u:
            tgt = {"banned": 0.02, "regulated": 0.25, "free": 0.6, "mandatory": 0.95}.get(pol.get("enhancement", "regulated"), 0.25)
            pops["enh"] = pops.get("enh", 0.0) + (tgt - pops.get("enh", 0.0)) * min(1.0, 0.05 * dt)
        bio = max(1e-6, c["pop"])
        dig_share = pops.get("dig", 0) / (bio + pops.get("dig", 0))
        ai_share = pops.get("ai", 0) / (bio + pops.get("ai", 0))
        rights = {"none": 1.0, "limited": 0.5, "equal": 0.0}
        c["flags"]["digital_tension"] = round(100 * dig_share * rights.get(pol.get("digital_rights", "none"), 1.0), 1)
        c["flags"]["ai_tension"] = round(100 * ai_share * rights.get(pol.get("ai_rights", "none"), 1.0), 1)
        c["flags"]["dig_share"] = round(dig_share, 4)
        # bio-conservative backlash against a fast transition
        if dig_share > 0.25 and pol.get("upload") in ("encouraged", "mass"):
            c["flags"]["bio_backlash"] = round(40 * dig_share, 1)
        else:
            c["flags"]["bio_backlash"] = 0.0
        # milestones of the transition
        fl = c["flags"]
        for thr in (0.01, 0.25, 0.5, 0.9):
            key = f"dig_{thr}"
            if dig_share >= thr and not fl.get(key):
                fl[key] = state["meta"]["year"]
                txt = {0.01: "The first sizeable community of uploaded minds now lives in the digital infrastructure of",
                       0.25: "A quarter of the citizens of", 0.5: "For the first time, the majority of the people of",
                       0.9: "Nine in ten citizens of"}[thr]
                suffix = {0.01: ".", 0.25: " now exist as digital minds.", 0.5: " are digital minds rather than biological bodies.",
                          0.9: " now live as digital consciousness; biological life has become a minority choice."}[thr]
                emit(state, "society", f"Digital transition in {c['name']}: {int(thr*100)}% uploaded", f"{txt} {c['name']}{suffix}",
                     [t], 4 if thr >= 0.5 else 3, tags=["digital", "society"])
                if thr >= 0.5:
                    state["milestones"].append({"y": state["meta"]["year"], "title": f"{c['name']} becomes majority-digital", "actors": [t], "kind": "society"})
