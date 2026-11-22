#!/usr/bin/env python
"""Regenerate Markdown reports from saved JSON artifacts (no recomputation, no holdout access).

Writes artifacts/research/{OOS_REPORT,MONTE_CARLO_REPORT,STRATEGY_CORRELATION_REPORT}.md and
artifacts/DATA_COVERAGE.md.
"""

from __future__ import annotations

import json
from pathlib import Path

import _bootstrap  # noqa: F401

from quant_engine.backtest.report_markdown import write_markdown_reports
from quant_engine.config.settings import get_env


def coverage_markdown(cov: dict) -> str:
    out = ["# Historical Data Coverage Report\n",
           f"Source exchange: **{cov['exchange']}** (spot OHLCV via the public market-data endpoint). "
           f"Requested start {cov['requested_start']}; generated {cov['generated_at']}.\n",
           "Gaps are reported and **never interpolated**; the integrity gate requires ≥ 99.5% completeness, "
           "no invalid OHLC rows and no non-positive prices.\n",
           "| series | rows | first | last | missing bars | gaps | duplicates | completeness | price-jump flags | passed |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for k, v in cov["ohlcv"].items():
        out.append(f"| {k} | {v['rows']} | {v['first']} | {v['last']} | {v['missing_bars']} | {v['gap_count']} | "
                   f"{v['duplicates']} | {v['completeness']:.4%} | {v['price_jump_anomalies']} | {v['passed']} |")
    out.append("\nGap windows are identical across BTC/ETH/SOL (exchange-wide maintenance), e.g.:\n")
    first = next(iter(cov["ohlcv"].values()))
    out += [f"* {g[0]} → {g[1]} ({g[2]} bars)" for g in first["gaps"][:10]]
    out.append("\n'Price-jump flags' are returns beyond 12 robust (MAD) standard deviations: reported for review, "
               "not removed (crypto returns are fat-tailed; these are real moves).\n")
    out.append("\n## Funding rates\n\n| symbol | rows | first | last | sources | max gap (h) |\n|---|---|---|---|---|---|")
    for k, v in cov.get("funding", {}).items():
        out.append(f"| {k} | {v['rows']} | {v['first']} | {v['last']} | {v['sources']} | {v['max_gap_hours']} |")
    return "\n".join(out) + "\n"


def main() -> None:
    art = Path(get_env().artifacts_dir)
    res = art / "research" / "research_results.json"
    if res.exists():
        write_markdown_reports(art / "research", json.loads(res.read_text()))
        print(f"wrote research reports under {art / 'research'}")
    cov = art / "data_coverage_report.json"
    if cov.exists():
        (art / "DATA_COVERAGE.md").write_text(coverage_markdown(json.loads(cov.read_text())))
        print(f"wrote {art / 'DATA_COVERAGE.md'}")


if __name__ == "__main__":
    main()
