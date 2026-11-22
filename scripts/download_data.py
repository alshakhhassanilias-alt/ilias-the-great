#!/usr/bin/env python
"""Download / incrementally update historical OHLCV and funding data, then write a coverage report.

Usage:
    python scripts/download_data.py [--start 2021-01-01] [--exchange binance] [--timeframes 15m 1h 4h 1d]
"""

from __future__ import annotations

import argparse
import json
import logging

import _bootstrap  # noqa: F401
import pandas as pd

from quant_engine.config.settings import get_config, get_env
from quant_engine.data.cache import ParquetCache
from quant_engine.data.database import get_engine
from quant_engine.data.exchanges.factory import create_public_exchange
from quant_engine.data.historical import (
    HistoricalDownloader,
    download_binance_funding_archive,
    download_okx_funding_recent,
    funding_coverage,
)
from quant_engine.monitoring.logging import setup_logging


def main() -> None:
    cfg = get_config()
    env = get_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default=cfg.research.start)
    ap.add_argument("--end", default=cfg.research.end)
    ap.add_argument("--exchange", default=cfg.exchanges.market_data_primary)
    ap.add_argument("--symbols", nargs="*", default=cfg.research.symbols)
    ap.add_argument("--timeframes", nargs="*", default=cfg.research.timeframes)
    ap.add_argument("--skip-funding", action="store_true")
    args = ap.parse_args()
    setup_logging("download_data")
    log = logging.getLogger("download_data")

    engine = get_engine(env.database_url)
    cache = ParquetCache(env.market_data_dir, engine)
    xcfg = cfg.exchanges.exchanges[args.exchange]
    ex = create_public_exchange(xcfg)
    ex.load_markets()
    dl = HistoricalDownloader(ex, args.exchange, cache, limit=xcfg.ohlcv_limit)

    coverage: dict[str, dict] = {"exchange": args.exchange, "requested_start": args.start,
                                 "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "ohlcv": {}, "funding": {}}
    for sym in args.symbols:
        for tf in args.timeframes:
            res = dl.download(sym, tf, args.start, args.end)
            rep = res.report.to_dict()
            coverage["ohlcv"][f"{sym} {tf}"] = rep
            log.info("%s %s: +%d rows, total %d, %s..%s, missing=%d, completeness=%.4f, passed=%s",
                     sym, tf, res.new_rows, res.total_rows, rep["first"], rep["last"], rep["missing_bars"],
                     rep["completeness"], rep["passed"])

    if not args.skip_funding:
        okx = create_public_exchange(cfg.exchanges.exchanges["okx"], market_type="swap")
        for sym in args.symbols:
            raw = xcfg.symbols[sym]
            start = pd.Timestamp(args.start, tz="UTC")
            arch = download_binance_funding_archive(raw, start, pd.Timestamp.now(tz="UTC"))
            try:
                recent = download_okx_funding_recent(okx, cfg.exchanges.exchanges["okx"].swap_symbols[sym])
            except Exception as exc:  # optional supplement only
                log.warning("OKX funding unavailable for %s: %s", sym, exc)
                recent = pd.DataFrame(columns=["funding_rate", "source"])
            if not arch.empty and not recent.empty:
                recent = recent[recent.index > arch.index[-1]]
            frames = [f for f in (arch, recent) if not f.empty]
            funding = pd.concat(frames).sort_index() if frames else arch
            cache.save(args.exchange, sym, "8h", funding, kind="funding")
            coverage["funding"][sym] = funding_coverage(funding)
            log.info("funding %s: %s", sym, coverage["funding"][sym])

    out = cache.root.parent / "coverage_report.json"
    out.write_text(json.dumps(coverage, indent=2, default=str))
    art = cfg_art = env.artifacts_dir
    import pathlib
    pathlib.Path(cfg_art).mkdir(parents=True, exist_ok=True)
    (pathlib.Path(art) / "data_coverage_report.json").write_text(json.dumps(coverage, indent=2, default=str))
    print(json.dumps({k: {"rows": v["rows"], "first": v["first"], "last": v["last"], "missing": v["missing_bars"],
                          "completeness": v["completeness"], "passed": v["passed"]}
                      for k, v in coverage["ohlcv"].items()}, indent=1))


if __name__ == "__main__":
    main()
