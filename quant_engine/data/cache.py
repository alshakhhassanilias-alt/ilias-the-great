"""Parquet market-data cache with a SQLite index.

Layout: ``<market_data_dir>/<exchange>/<SYMBOL>_<tf>.parquet`` (open-time index, UTC).
The SQLite ``data_cache_index`` table records coverage, row counts, gap counts and a
content hash so unchanged history is never re-downloaded and silent corruption is detectable.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine

from quant_engine.core.types import ts_ms
from quant_engine.data.database import data_cache_index, utc_now_iso
from quant_engine.data.normalization import OHLCV_COLUMNS, symbol_to_filename


class ParquetCache:
    def __init__(self, root: str | Path, engine: Engine | None = None) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine = engine

    def path(self, exchange: str, symbol: str, timeframe: str, kind: str = "ohlcv") -> Path:
        suffix = "" if kind == "ohlcv" else f"_{kind}"
        return self.root / exchange / f"{symbol_to_filename(symbol)}_{timeframe}{suffix}.parquet"

    def load(self, exchange: str, symbol: str, timeframe: str, kind: str = "ohlcv") -> pd.DataFrame:
        p = self.path(exchange, symbol, timeframe, kind)
        if not p.exists():
            if kind == "ohlcv":
                return pd.DataFrame(
                    columns=OHLCV_COLUMNS, index=pd.DatetimeIndex([], tz="UTC", name="open_time"), dtype="float64"
                )
            return pd.DataFrame()
        df = pd.read_parquet(p)
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
        return df

    def save(self, exchange: str, symbol: str, timeframe: str, df: pd.DataFrame, kind: str = "ohlcv") -> Path:
        p = self.path(exchange, symbol, timeframe, kind)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".parquet.tmp")
        df.to_parquet(tmp, engine="pyarrow", compression="zstd")
        tmp.replace(p)  # atomic on POSIX
        return p

    @staticmethod
    def file_hash(path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def update_index(self, exchange: str, symbol: str, timeframe: str, df: pd.DataFrame, validation: dict[str, Any]) -> None:
        if self.engine is None:
            return
        p = self.path(exchange, symbol, timeframe)
        row = {
            "exchange": exchange,
            "symbol": symbol,
            "timeframe": timeframe,
            "path": str(p),
            "first_open_ms": ts_ms(df.index[0]) if len(df) else None,
            "last_open_ms": ts_ms(df.index[-1]) if len(df) else None,
            "rows": len(df),
            "missing_bars": int(validation.get("missing_bars", 0)),
            "duplicates_removed": int(validation.get("duplicates", 0)),
            "sha256": self.file_hash(p) if p.exists() else None,
            "updated_at": utc_now_iso(),
            "validation_json": json.dumps(validation, default=str),
        }
        stmt = sqlite_insert(data_cache_index).values(**row)
        stmt = stmt.on_conflict_do_update(
            index_elements=["exchange", "symbol", "timeframe"],
            set_={k: v for k, v in row.items() if k not in {"exchange", "symbol", "timeframe"}},
        )
        with self.engine.begin() as conn:
            conn.execute(stmt)

    def index_rows(self) -> list[dict[str, Any]]:
        if self.engine is None:
            return []
        with self.engine.connect() as conn:
            return [dict(r._mapping) for r in conn.execute(select(data_cache_index))]

    def verify_hash(self, exchange: str, symbol: str, timeframe: str) -> bool:
        p = self.path(exchange, symbol, timeframe)
        for r in self.index_rows():
            if (r["exchange"], r["symbol"], r["timeframe"]) == (exchange, symbol, timeframe):
                return p.exists() and r["sha256"] == self.file_hash(p)
        return False
