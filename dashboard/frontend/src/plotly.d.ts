// Minimal type shims for packages that ship without TypeScript declarations.
declare module "plotly.js-dist-min" {
  const Plotly: unknown;
  export default Plotly;
}

declare module "react-plotly.js/factory" {
  import type { ComponentType, CSSProperties } from "react";

  export interface PlotParams {
    data: Array<Record<string, unknown>>;
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
    frames?: Array<Record<string, unknown>>;
    style?: CSSProperties;
    className?: string;
    useResizeHandler?: boolean;
    revision?: number;
    divId?: string;
    onInitialized?: (figure: unknown, graphDiv: HTMLElement) => void;
    onUpdate?: (figure: unknown, graphDiv: HTMLElement) => void;
    onError?: (err: unknown) => void;
  }

  export default function createPlotlyComponent(plotly: unknown): ComponentType<PlotParams>;
}
