import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import type { ReactNode } from "react";

const Plot = createPlotlyComponent(Plotly);

export const C = {
  bg: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  grid: "#21262d",
  text: "#c9d1d9",
  muted: "#8b949e",
  green: "#3fb950",
  red: "#f85149",
  amber: "#d29922",
  blue: "#58a6ff",
  purple: "#bc8cff",
};

/** Categorical series palette (distinct on the dark panel background). */
export const SERIES = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#ff7b72", "#39c5cf", "#e3b341", "#f778ba", "#a5d6ff", "#7ee787"];

type Dict = Record<string, unknown>;

interface ChartProps {
  title: string;
  xTitle: string;
  yTitle: string;
  data: Dict[];
  height?: number;
  layout?: Dict;
  yaxis?: Dict;
  xaxis?: Dict;
  testId?: string;
  note?: ReactNode;
}

export function Chart({ title, xTitle, yTitle, data, height = 300, layout, yaxis, xaxis, testId, note }: ChartProps) {
  const showLegend = data.filter((d) => d.showlegend !== false).length > 1;
  const fullLayout: Dict = {
    // title sits just above the plot area, below the modebar strip, so the two never overlap on narrow screens
    title: { text: title, font: { size: 13, color: C.text }, x: 0, xref: "paper", xanchor: "left", y: 1, yref: "paper", yanchor: "bottom", pad: { b: 8 } },
    paper_bgcolor: C.panel,
    plot_bgcolor: C.panel,
    font: { family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", size: 11, color: C.text },
    autosize: true,
    height,
    margin: { l: 58, r: 14, t: 58, b: 40 },
    hovermode: "x unified",
    hoverlabel: { bgcolor: C.bg, bordercolor: C.border, font: { color: C.text } },
    showlegend: showLegend,
    legend: { orientation: "h", x: 0, y: -0.22, yanchor: "top", font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
    xaxis: {
      title: { text: xTitle, font: { size: 11, color: C.muted }, standoff: 6 },
      gridcolor: C.grid,
      linecolor: C.border,
      zerolinecolor: C.border,
      automargin: true,
      ...xaxis,
    },
    yaxis: {
      title: { text: yTitle, font: { size: 11, color: C.muted }, standoff: 6 },
      gridcolor: C.grid,
      linecolor: C.border,
      zerolinecolor: C.border,
      automargin: true,
      ...yaxis,
    },
    ...layout,
  };
  if (showLegend) {
    // leave room for the horizontal legend under the x axis
    fullLayout.margin = { l: 58, r: 14, t: 58, b: 70 };
    fullLayout.height = height + 30;
  }
  return (
    <div className="chart" data-testid={testId}>
      <Plot
        data={data}
        layout={fullLayout}
        config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] }}
        useResizeHandler
        style={{ width: "100%", height: `${fullLayout.height as number}px` }}
      />
      {note ? <div className="chart-note">{note}</div> : null}
    </div>
  );
}

/** Placeholder with the same footprint as a chart, used for explicit empty states. */
export function ChartEmpty({ title, message, testId, height = 300 }: { title: string; message: string; testId?: string; height?: number }) {
  return (
    <div className="chart chart-empty" data-testid={testId} style={{ minHeight: height }}>
      <div className="chart-empty-title">{title}</div>
      <div className="empty">{message}</div>
    </div>
  );
}
