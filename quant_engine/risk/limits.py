"""Hard exposure limits.  Returns the largest permissible quantity (possibly 0)."""

from __future__ import annotations

from dataclasses import dataclass, field

from quant_engine.config.settings import ExposureLimitsConfig


@dataclass
class PortfolioView:
    equity: float
    marks: dict[str, float]
    # (strategy_id, symbol, signed quantity)
    positions: list[tuple[str, str, float]] = field(default_factory=list)

    def gross(self) -> float:
        return sum(abs(q) * self.marks.get(s, 0.0) for _, s, q in self.positions)

    def net(self) -> float:
        return sum(q * self.marks.get(s, 0.0) for _, s, q in self.positions)

    def symbol_net(self, symbol: str) -> float:
        return sum(q * self.marks.get(s, 0.0) for _, s, q in self.positions if s == symbol)

    def open_count(self) -> int:
        return sum(1 for *_, q in self.positions if abs(q) > 1e-12)


def cap_quantity(view: PortfolioView, symbol: str, direction: int, price: float, qty: float,
                 cfg: ExposureLimitsConfig) -> tuple[float, list[str]]:
    notes: list[str] = []
    eq = view.equity
    if eq <= 0 or price <= 0:
        return 0.0, ["non_positive_equity_or_price"]
    if view.open_count() >= cfg.max_open_positions:
        return 0.0, ["max_open_positions"]
    caps = [qty]
    gross_room = min(cfg.max_gross_exposure, cfg.max_leverage) * eq - view.gross()
    caps.append(max(gross_room, 0.0) / price)
    if gross_room < qty * price:
        notes.append("gross_exposure_cap")
    net_after_room = cfg.max_net_exposure * eq - direction * view.net()
    caps.append(max(net_after_room, 0.0) / price)
    if net_after_room < qty * price:
        notes.append("net_exposure_cap")
    sym_room = cfg.max_asset_concentration * eq - direction * view.symbol_net(symbol)
    caps.append(max(sym_room, 0.0) / price)
    if sym_room < qty * price:
        notes.append("asset_concentration_cap")
    q = max(min(caps), 0.0)
    if q * price < cfg.min_order_notional:
        return 0.0, [*notes, "below_min_notional"]
    return q, notes
