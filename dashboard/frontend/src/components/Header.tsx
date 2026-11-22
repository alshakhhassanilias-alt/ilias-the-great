import type { Overview } from "../types";
import type { WsState } from "../useDashboard";
import { StatusBadge } from "./Badges";

const MODE_CLASS: Record<string, string> = { PAPER: "mode-paper", TESTNET: "mode-testnet", LIVE: "mode-live" };

const WS_LABEL: Record<WsState, string> = {
  connecting: "CONNECTING",
  live: "LIVE FEED",
  stale: "STALE",
  offline: "FEED OFFLINE",
};

interface Props {
  overview: Overview | null;
  loginMode: string | null;
  ws: WsState;
  lastWsUpdate: number | null;
  onLogout: () => void;
}

export default function Header({ overview, loginMode, ws, lastWsUpdate, onLogout }: Props) {
  const mode = (overview?.mode ?? loginMode ?? "").toUpperCase();
  const wsTitle = lastWsUpdate
    ? `Last websocket update ${new Date(lastWsUpdate).toISOString().slice(11, 19)}Z`
    : "No websocket update received yet";
  return (
    <header className="topbar">
      <div className="brand">
        QUANT ENGINE <span className="brand-sep">·</span> <span className="brand-sub">Command Center</span>
      </div>
      <div className="topbar-right">
        <span className={`mode-badge ${MODE_CLASS[mode] ?? "mode-unknown"}`} data-testid="mode-badge" title="Trading mode">
          {mode || "MODE ?"}
        </span>
        <StatusBadge status={overview?.system_status} testId="system-status" />
        <span className={`ws-ind ws-${ws}`} title={wsTitle} data-testid="ws-indicator">
          <span className="dot" aria-hidden="true" />
          {WS_LABEL[ws]}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onLogout} type="button">
          Log out
        </button>
      </div>
    </header>
  );
}
