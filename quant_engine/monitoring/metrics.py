"""Lightweight in-process runtime metrics (latency percentiles, counters, slippage)."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import numpy as np


class RuntimeMetrics:
    def __init__(self, window: int = 500) -> None:
        self.counters: dict[str, int] = defaultdict(int)
        self.samples: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=window))

    def inc(self, name: str, n: int = 1) -> None:
        self.counters[name] += n

    def observe(self, name: str, value: float) -> None:
        self.samples[name].append(float(value))

    def summary(self) -> dict[str, Any]:
        out: dict[str, Any] = {"counters": dict(self.counters)}
        for k, v in self.samples.items():
            arr = np.array(v)
            if len(arr):
                out[k] = {
                    "n": len(arr),
                    "p50": float(np.percentile(arr, 50)),
                    "p95": float(np.percentile(arr, 95)),
                    "max": float(arr.max()),
                    "last": float(arr[-1]),
                }
        return out
