import { useDashboard } from "../useDashboard";
import EmergencyControls from "./EmergencyControls";
import Header from "./Header";
import Kpis from "./Kpis";
import LiveCharts from "./LiveCharts";
import MonteCarloPanel from "./MonteCarloPanel";
import ResearchPanel from "./ResearchPanel";
import RiskPanel from "./RiskPanel";
import { OrdersPanel, PositionsPanel, RegimePanel, StrategiesPanel, TradesPanel } from "./TradingTables";

interface Props {
  token: string;
  loginMode: string | null;
  onLogout: () => void;
}

export default function Dashboard({ token, loginMode, onLogout }: Props) {
  const d = useDashboard(token);
  const ov = d.overview.data;
  const mode = (ov?.mode ?? loginMode ?? "").toUpperCase();
  return (
    <div className={`app app-mode-${mode.toLowerCase() || "unknown"}`}>
      <Header overview={ov} loginMode={loginMode} ws={d.ws} lastWsUpdate={d.lastWsUpdate} onLogout={onLogout} />
      <main className="content">
        <EmergencyControls halted={!!ov?.halted} onDone={d.refresh} />
        <Kpis overview={ov} error={d.overview.error} />
        <div className="layout-main">
          <div className="col-main">
            <LiveCharts equity={d.equity.data} error={d.equity.error} mode={mode} />
          </div>
          <div className="col-side">
            <RiskPanel risk={d.risk} health={d.health} />
            <RegimePanel regime={d.regime} />
          </div>
        </div>
        <PositionsPanel positions={d.positions} />
        <StrategiesPanel strategies={d.strategies} />
        <OrdersPanel orders={d.orders} />
        <TradesPanel trades={d.trades} />
        <ResearchPanel research={d.research} />
        <MonteCarloPanel montecarlo={d.montecarlo} />
        <footer className="foot muted small">
          QUANT ENGINE · Command Center — REST fallback polling every 15 s · live feed via WebSocket. All times UTC.
        </footer>
      </main>
    </div>
  );
}
