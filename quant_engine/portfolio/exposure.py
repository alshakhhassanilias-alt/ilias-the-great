"""Exposure aggregation helpers (per symbol / strategy, gross / net / leverage)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExposureSnapshot:
    equity: float
    gross: float
    net: float
    by_symbol: dict[str, float]
    by_strategy: dict[str, float]

    @property
    def leverage(self) -> float:
        return self.gross / self.equity if self.equity > 0 else float("inf")


def aggregate(equity: float, positions: list[tuple[str, str, float]], marks: dict[str, float]) -> ExposureSnapshot:
    by_sym: dict[str, float] = {}
    by_strat: dict[str, float] = {}
    gross = net = 0.0
    for strat, sym, qty in positions:
        n = qty * marks.get(sym, 0.0)
        by_sym[sym] = by_sym.get(sym, 0.0) + n
        by_strat[strat] = by_strat.get(strat, 0.0) + abs(n)
        gross += abs(n)
        net += n
    return ExposureSnapshot(equity, gross, net, by_sym, by_strat)
