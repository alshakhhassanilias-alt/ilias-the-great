import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "./api";
import type {
  EquityPoint,
  Health,
  MonteCarloResponse,
  Order,
  Overview,
  Position,
  RegimeResponse,
  ResearchResponse,
  Risk,
  StrategyRow,
  Trade,
  WsUpdate,
} from "./types";

export type WsState = "connecting" | "live" | "stale" | "offline";

/** A REST-backed value plus its last load error (null value = not loaded / unavailable). */
export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loadedAt: number | null;
}

const empty = <T,>(): Loadable<T> => ({ data: null, error: null, loadedAt: null });

const POLL_MS = 15_000;
const SLOW_POLL_MS = 300_000;
const STALE_MS = 10_000;
const MAX_EQUITY_POINTS = 50_000;

export interface Dashboard {
  overview: Loadable<Overview>;
  equity: Loadable<EquityPoint[]>;
  positions: Loadable<Position[]>;
  risk: Loadable<Risk>;
  health: Loadable<Health>;
  strategies: Loadable<StrategyRow[]>;
  regime: Loadable<RegimeResponse>;
  orders: Loadable<Order[]>;
  trades: Loadable<Trade[]>;
  research: Loadable<ResearchResponse>;
  montecarlo: Loadable<MonteCarloResponse>;
  ws: WsState;
  lastWsUpdate: number | null;
  refresh: () => void;
}

function mergeEquity(prev: EquityPoint[] | null, pt: EquityPoint): EquityPoint[] {
  const arr = prev ?? [];
  const last = arr[arr.length - 1];
  if (last) {
    if (pt.id != null && last.id != null && pt.id <= last.id) return arr;
    if (pt.id == null && last.timestamp === pt.timestamp) return arr;
  }
  const next = arr.concat(pt);
  return next.length > MAX_EQUITY_POINTS ? next.slice(next.length - MAX_EQUITY_POINTS) : next;
}

export function useDashboard(token: string): Dashboard {
  const [overview, setOverview] = useState<Loadable<Overview>>(empty);
  const [equity, setEquity] = useState<Loadable<EquityPoint[]>>(empty);
  const [positions, setPositions] = useState<Loadable<Position[]>>(empty);
  const [risk, setRisk] = useState<Loadable<Risk>>(empty);
  const [health, setHealth] = useState<Loadable<Health>>(empty);
  const [strategies, setStrategies] = useState<Loadable<StrategyRow[]>>(empty);
  const [regime, setRegime] = useState<Loadable<RegimeResponse>>(empty);
  const [orders, setOrders] = useState<Loadable<Order[]>>(empty);
  const [trades, setTrades] = useState<Loadable<Trade[]>>(empty);
  const [research, setResearch] = useState<Loadable<ResearchResponse>>(empty);
  const [montecarlo, setMontecarlo] = useState<Loadable<MonteCarloResponse>>(empty);
  const [ws, setWs] = useState<WsState>("connecting");
  const [lastWsUpdate, setLastWsUpdate] = useState<number | null>(null);
  const lastWsRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(<T,>(path: string, set: (fn: (p: Loadable<T>) => Loadable<T>) => void) => {
    return apiGet<T>(path).then(
      (data) => {
        if (aliveRef.current) set(() => ({ data, error: null, loadedAt: Date.now() }));
      },
      (err: unknown) => {
        if (!aliveRef.current || (err instanceof ApiError && err.status === 401)) return;
        const msg = err instanceof Error ? err.message : String(err);
        // keep the last good data but surface the error
        set((p) => ({ ...p, error: msg }));
      },
    );
  }, []);

  const pollFast = useCallback(() => {
    const wsFresh = lastWsRef.current !== null && Date.now() - lastWsRef.current < STALE_MS;
    void load<Overview>("/api/overview", setOverview);
    void load<Position[]>("/api/positions", setPositions);
    void load<Risk>("/api/risk", setRisk);
    void load<Health>("/api/health", setHealth);
    void load<RegimeResponse>("/api/regime", setRegime);
    void load<Order[]>("/api/orders?limit=100", setOrders);
    void load<Trade[]>("/api/trades?limit=1000", setTrades);
    void load<StrategyRow[]>("/api/strategies", setStrategies);
    // when the live feed is healthy the equity curve is extended from websocket points
    if (!wsFresh) void load<EquityPoint[]>("/api/equity?limit=5000", setEquity);
  }, [load]);

  const pollSlow = useCallback(() => {
    void load<ResearchResponse>("/api/research", setResearch);
    void load<MonteCarloResponse>("/api/montecarlo", setMontecarlo);
  }, [load]);

  const refresh = useCallback(() => {
    pollFast();
    void load<EquityPoint[]>("/api/equity?limit=5000", setEquity);
  }, [pollFast, load]);

  // REST: initial load + fallback polling
  useEffect(() => {
    aliveRef.current = true;
    pollFast();
    pollSlow();
    const a = window.setInterval(pollFast, POLL_MS);
    const b = window.setInterval(pollSlow, SLOW_POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, [pollFast, pollSlow]);

  // WebSocket live feed with exponential-backoff reconnect
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let closed = false;

    const applyUpdate = (msg: WsUpdate) => {
      const now = Date.now();
      lastWsRef.current = now;
      setLastWsUpdate(now);
      setWs("live");
      if (msg.overview) {
        const ov = msg.overview;
        setOverview({ data: ov, error: null, loadedAt: now });
      }
      if (msg.equity_point) {
        const pt = msg.equity_point;
        setEquity((p) => ({ ...p, data: mergeEquity(p.data, pt), loadedAt: now }));
      }
      if (Array.isArray(msg.positions)) {
        const pos = msg.positions;
        setPositions({ data: pos, error: null, loadedAt: now });
      }
      if (msg.risk) {
        const r = msg.risk;
        // websocket risk omits limits/events: merge over the last REST snapshot
        setRisk((p) => ({ data: { ...(p.data ?? ({} as Risk)), ...r } as Risk, error: null, loadedAt: now }));
      }
      if (msg.regime && typeof msg.regime === "object") {
        const reg = msg.regime;
        setRegime((p) => ({ data: { regimes: reg, timestamp: p.data?.timestamp ?? null }, error: null, loadedAt: now }));
      }
    };

    const connect = () => {
      if (closed) return;
      setWs((s) => (s === "live" ? "stale" : "connecting"));
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "auth", token }));
      };
      socket.onmessage = (ev: MessageEvent) => {
        let msg: { type?: string } & Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "auth_ok") {
          retry = 0;
          lastWsRef.current = Date.now();
          setLastWsUpdate(Date.now());
          setWs("live");
        } else if (msg.type === "update") {
          applyUpdate(msg as unknown as WsUpdate);
        } else if (msg.type === "error") {
          // auth failure: a REST call will detect an expired token (401 -> login screen)
          void apiGet("/api/overview").catch(() => undefined);
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!closed) scheduleReconnect();
      };
      socket.onerror = () => {
        /* onclose follows and handles reconnect */
      };
    };

    const scheduleReconnect = () => {
      setWs(lastWsRef.current && Date.now() - lastWsRef.current < STALE_MS ? "stale" : "offline");
      const delay = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
      retry = Math.min(retry + 1, 6);
      timer = window.setTimeout(connect, delay);
    };

    connect();

    const staleCheck = window.setInterval(() => {
      const last = lastWsRef.current;
      if (last !== null && Date.now() - last > STALE_MS) {
        setWs((s) => (s === "live" ? "stale" : s));
      }
    }, 1000);

    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(staleCheck);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [token]);

  return {
    overview,
    equity,
    positions,
    risk,
    health,
    strategies,
    regime,
    orders,
    trades,
    research,
    montecarlo,
    ws,
    lastWsUpdate,
    refresh,
  };
}
