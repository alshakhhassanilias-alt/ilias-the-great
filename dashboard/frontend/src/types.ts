// API response shapes (see quant_engine/dashboard/backend). All numeric fields may be null.
export type Num = number | null | undefined;

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  mode: string;
}

export interface Overview {
  mode: string;
  system_status: string;
  engine_heartbeat_age_s: Num;
  has_data: boolean;
  total_equity: Num;
  available_balance: Num;
  cash: Num;
  unrealized_pnl: Num;
  realized_pnl: Num;
  daily_pnl: Num;
  total_return: Num;
  current_drawdown: Num;
  gross_exposure: Num;
  halted: boolean;
  kill_switch: boolean;
  halt_reason: string | null;
  timestamp: string | null;
}

export interface EquityPoint {
  id: number;
  mode?: string;
  timestamp: string;
  equity: Num;
  cash: Num;
  unrealized_pnl: Num;
  realized_pnl: Num;
  gross_exposure: Num;
  drawdown: Num;
}

export interface Position {
  symbol: string;
  strategy_id: string;
  direction: string;
  quantity: Num;
  avg_entry_price: Num;
  current_price: Num;
  stop_loss: Num;
  take_profit: Num;
  unrealized_pnl: Num;
  notional: Num;
  opened_at: string | null;
  diagnostic: boolean;
}

export interface StrategyRow {
  strategy_id: string;
  timeframe: string | null;
  max_weight: Num;
  validation_status: string;
  live_weight: Num;
  last_signal_ts: string | null;
  oos_sharpe: Num;
  oos_net_return: Num;
  oos_max_drawdown: Num;
  oos_trades: Num;
  dsr: Num;
  pbo: Num;
}

export interface RegimeResponse {
  regimes: Record<string, unknown>;
  timestamp: string | null;
}

export interface Order {
  client_order_id: string;
  symbol: string;
  side: string;
  order_type: string;
  intent: string | null;
  strategy_id: string | null;
  quantity: Num;
  price: Num;
  stop_price: Num;
  status: string;
  filled_quantity: Num;
  avg_fill_price: Num;
  fees_paid: Num;
  reject_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Trade {
  trade_id: string | number;
  strategy_id: string;
  symbol: string;
  direction: number | string;
  quantity: Num;
  entry_price: Num;
  exit_price: Num;
  entry_time: string | null;
  exit_time: string | null;
  pnl: Num;
  fees: Num;
  funding: Num;
  exit_reason: string | null;
}

export interface RiskEvent {
  timestamp: string | null;
  severity: string | null;
  event_type: string | null;
  message: string | null;
}

export interface Risk {
  daily_drawdown: Num;
  daily_drawdown_limit: Num;
  total_drawdown: Num;
  total_drawdown_limit: Num;
  halted: boolean;
  kill_switch: boolean;
  halt_reason: string | null;
  requires_authorization: boolean;
  transient_blocks: Record<string, unknown>;
  breach_count: Record<string, unknown>;
  api_latency_ms: Num;
  data_age_seconds: Num;
  consecutive_errors: Num;
  exchange_connectivity: string | null;
  health_reasons: string[];
  limits?: Record<string, unknown>;
  events?: RiskEvent[];
}

export interface Health {
  heartbeat: { status: string; timestamp: string | null; age_seconds: Num; details?: Record<string, unknown> };
  database: { ok: boolean; detail: string | null };
}

export type MetricMap = Record<string, unknown>;

export interface ResearchResponse {
  available: boolean;
  generated_at?: string;
  data?: { oos_start?: string; oos_end?: string; holdout_start?: string; holdout_end?: string; oos_years?: Num };
  promotion?: Record<string, { status: string; checks?: Record<string, { passed: boolean; value: unknown; threshold: unknown }> }>;
  deployable?: string[];
  strategies?: Record<string, { summary: MetricMap; windows?: unknown[] }>;
  combined?: Record<string, { summary: MetricMap; windows?: unknown[] }>;
  benchmarks?: { stitched_oos?: Record<string, MetricMap> };
  holdout?: { results?: Record<string, MetricMap>; benchmarks?: Record<string, unknown> };
  n_total_trials?: Num;
  series?: {
    index?: string[];
    curves?: Record<string, (number | null)[]>;
    rolling_sharpe?: Record<string, (number | null)[]>;
    drawdown?: Record<string, (number | null)[]>;
  };
}

export interface McScenarioSummary {
  terminal_equity_median: Num;
  terminal_equity_p05: Num;
  terminal_equity_p95: Num;
  max_drawdown_median: Num;
  max_drawdown_p95: Num;
  prob_daily_dd_breach: Num;
  prob_total_dd_breach: Num;
  prob_ruin: Num;
  prob_loss: Num;
  description?: string;
}

export interface MonteCarloResponse {
  portfolio: string | null;
  qualified: boolean | null;
  summary: Record<string, McScenarioSummary>;
  distributions: Record<string, { terminal?: number[]; max_drawdown?: number[] }>;
}

export type ControlAction = "flatten" | "kill-switch" | "cancel-orders" | "resume";

export interface ControlResponse {
  command_id: number | string;
  status: "done" | "failed" | "queued" | string;
  result: Record<string, unknown> | null;
  halt_persisted: boolean;
}

export interface WsUpdate {
  type: "update";
  overview?: Overview;
  equity_point?: EquityPoint | null;
  positions?: Position[];
  risk?: Partial<Risk>;
  regime?: Record<string, unknown>;
}
