"""Order manager: idempotent submission, retry with backoff, error accounting.

Duplicate protection is layered:
1. deterministic client order ids (same intent -> same id),
2. local lookup (in-memory + database) before any submission,
3. broker-side lookup by client id before *re*-submitting after a timeout (the first request
   may have reached the exchange even though the response was lost).
"""

from __future__ import annotations

import logging
import time

import ccxt

from quant_engine.core.types import Order, OrderStatus
from quant_engine.execution.exchange_adapter import Broker, SymbolSnapshot
from quant_engine.execution.state_store import StateStore
from quant_engine.risk.circuit_breaker import CircuitBreaker

log = logging.getLogger(__name__)
TRANSIENT = (ccxt.NetworkError, ccxt.RequestTimeout, ccxt.ExchangeNotAvailable, ccxt.RateLimitExceeded,
             TimeoutError, ConnectionError)


class OrderManager:
    def __init__(self, broker: Broker, store: StateStore, breaker: CircuitBreaker, max_attempts: int = 3,
                 backoff_s: float = 0.5, sleep=time.sleep) -> None:
        self.broker = broker
        self.store = store
        self.breaker = breaker
        self.max_attempts = max_attempts
        self.backoff_s = backoff_s
        self.sleep = sleep
        self.submitted: dict[str, Order] = {}

    def submit(self, order: Order, snapshot: SymbolSnapshot | None = None) -> Order:
        cid = order.client_order_id
        if cid in self.submitted:
            return self.submitted[cid]
        existing = self.store.get_order(cid)
        if existing is not None and existing.status is not OrderStatus.PENDING:
            self.submitted[cid] = existing
            return existing
        last_exc: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                res = self.broker.submit(order, snapshot)  # broker.submit is idempotent on client id
                self.breaker.record_exchange_success()
                self.submitted[cid] = res
                if res.status is OrderStatus.REJECTED:
                    log.warning("order %s rejected: %s", cid, res.reject_reason)
                return res
            except TRANSIENT as exc:
                last_exc = exc
                self.breaker.record_exchange_error(order.created_at.isoformat(), f"{type(exc).__name__}")
                log.warning("transient submit failure %s (attempt %d): %s", cid, attempt, type(exc).__name__)
                self.sleep(self.backoff_s * 2 ** (attempt - 1))
            except Exception as exc:  # non-retryable: record and reject (fail closed)
                self.breaker.record_exchange_error(order.created_at.isoformat(), f"{type(exc).__name__}")
                order.status = OrderStatus.REJECTED
                order.reject_reason = f"{type(exc).__name__}: {str(exc)[:200]}"
                self.store.save_order(order)
                self.submitted[cid] = order
                return order
        order.status = OrderStatus.REJECTED
        order.reject_reason = f"exhausted retries: {type(last_exc).__name__ if last_exc else 'unknown'}"
        self.store.save_order(order)
        self.submitted[cid] = order
        return order
