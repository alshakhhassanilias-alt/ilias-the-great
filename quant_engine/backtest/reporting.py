"""Report generation: Plotly charts (HTML + PNG) and Markdown tables.

PNGs are rendered by loading the self-contained Plotly HTML in headless Chromium
(Playwright), which avoids an extra image-export dependency.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

log = logging.getLogger(__name__)

DARK = dict(template="plotly_dark", paper_bgcolor="#0d1117", plot_bgcolor="#0d1117",
            font=dict(family="Inter, Segoe UI, sans-serif", size=13, color="#c9d1d9"))
PALETTE = ["#58a6ff", "#3fb950", "#d29922", "#f778ba", "#a371f7", "#ff7b72", "#79c0ff", "#8b949e"]


def save_figure(fig: go.Figure, out_dir: Path, name: str, width: int = 1200, height: int = 600) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    html = out_dir / f"{name}.html"
    fig.update_layout(**DARK, width=width, height=height, margin=dict(l=60, r=30, t=60, b=50))
    fig.write_html(html, include_plotlyjs="inline", full_html=True)
    paths = {"html": str(html)}
    try:
        from playwright.sync_api import sync_playwright

        png = out_dir / f"{name}.png"
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            pg.goto(html.resolve().as_uri())
            pg.wait_for_selector(".main-svg", timeout=20_000)
            pg.screenshot(path=str(png))
            b.close()
        paths["png"] = str(png)
    except Exception as exc:  # PNG is a convenience; HTML is the primary artifact
        log.warning("PNG export failed for %s: %s", name, exc)
    return paths


def equity_chart(curves: dict[str, pd.Series], title: str) -> go.Figure:
    fig = go.Figure()
    for i, (k, s) in enumerate(curves.items()):
        if len(s):
            fig.add_trace(go.Scatter(x=s.index, y=s.values, name=k, mode="lines",
                                     line=dict(width=2 if i < 5 else 1.2, color=PALETTE[i % len(PALETTE)],
                                               dash="dot" if k.startswith("buy_hold") or k == "cash" else None)))
    fig.update_layout(title=title, yaxis_title="Growth of 1 (net of modelled costs)", xaxis_title="Date (UTC)",
                      legend=dict(orientation="h", y=-0.15))
    return fig


def drawdown_chart(curves: dict[str, pd.Series], title: str) -> go.Figure:
    fig = go.Figure()
    for i, (k, s) in enumerate(curves.items()):
        if len(s):
            dd = s / s.cummax() - 1
            fig.add_trace(go.Scatter(x=dd.index, y=dd.values * 100, name=k, mode="lines", fill="tozeroy" if i == 0 else None,
                                     line=dict(width=1.5, color=PALETTE[i % len(PALETTE)])))
    fig.update_layout(title=title, yaxis_title="Drawdown (%)", xaxis_title="Date (UTC)",
                      legend=dict(orientation="h", y=-0.15))
    return fig


def rolling_sharpe_chart(daily: dict[str, pd.Series], window: int, title: str) -> go.Figure:
    fig = go.Figure()
    for i, (k, r) in enumerate(daily.items()):
        rs = r.rolling(window, min_periods=window // 2).mean() / r.rolling(window, min_periods=window // 2).std() * np.sqrt(365)
        fig.add_trace(go.Scatter(x=rs.index, y=rs.values, name=k, mode="lines", line=dict(color=PALETTE[i % len(PALETTE)])))
    fig.add_hline(y=0, line_color="#8b949e", line_dash="dash")
    fig.update_layout(title=title, yaxis_title=f"Rolling {window}-day Sharpe", legend=dict(orientation="h", y=-0.15))
    return fig


def heatmap(matrix: pd.DataFrame, title: str) -> go.Figure:
    fig = go.Figure(go.Heatmap(z=matrix.values, x=list(matrix.columns), y=list(matrix.index), zmin=-1, zmax=1,
                               colorscale="RdBu", reversescale=True, text=np.round(matrix.values, 2),
                               texttemplate="%{text}", colorbar=dict(title="ρ")))
    fig.update_layout(title=title)
    return fig


def rolling_corr_chart(roll: dict[str, pd.Series], title: str) -> go.Figure:
    fig = go.Figure()
    for i, (k, s) in enumerate(roll.items()):
        fig.add_trace(go.Scatter(x=s.index, y=s.values, name=k.replace("|", " vs "), mode="lines",
                                 line=dict(color=PALETTE[i % len(PALETTE)], width=1.4)))
    fig.update_layout(title=title, yaxis_title="Rolling 90-day correlation", yaxis_range=[-1, 1],
                      legend=dict(orientation="h", y=-0.2))
    return fig


def window_bar_chart(table: pd.DataFrame, title: str) -> go.Figure:
    fig = go.Figure()
    for i, col in enumerate(table.columns):
        fig.add_trace(go.Bar(x=table.index.astype(str), y=table[col].values * 100, name=col,
                             marker_color=PALETTE[i % len(PALETTE)]))
    fig.update_layout(title=title, barmode="group", yaxis_title="OOS window net return (%)",
                      xaxis_title="Test window start", legend=dict(orientation="h", y=-0.2))
    return fig


def mc_distribution_chart(mc: dict[str, Any], title: str) -> go.Figure:
    fig = make_subplots(rows=1, cols=2, subplot_titles=("Terminal equity (growth of 1)", "Maximum drawdown"))
    for i, (name, sc) in enumerate(mc["scenarios"].items()):
        col = PALETTE[i % len(PALETTE)]
        fig.add_trace(go.Histogram(x=sc["_terminal"], name=name, opacity=0.55, nbinsx=60, marker_color=col,
                                   legendgroup=name), 1, 1)
        fig.add_trace(go.Histogram(x=sc["_mdd"] * 100, name=name, opacity=0.55, nbinsx=60, marker_color=col,
                                   legendgroup=name, showlegend=False), 1, 2)
    fig.update_layout(title=title, barmode="overlay", legend=dict(orientation="h", y=-0.2))
    fig.update_xaxes(title_text="Terminal equity", row=1, col=1)
    fig.update_xaxes(title_text="Max drawdown (%)", row=1, col=2)
    return fig


def md_table(rows: list[dict[str, Any]], cols: list[str], fmt: dict[str, str] | None = None) -> str:
    fmt = fmt or {}
    head = "| " + " | ".join(cols) + " |\n|" + "|".join("---" for _ in cols) + "|\n"
    body = []
    for r in rows:
        cells = []
        for c in cols:
            v = r.get(c, "")
            if isinstance(v, float | np.floating):
                f = fmt.get(c, "{:.3f}")
                v = "n/a" if not np.isfinite(v) else f.format(v)
            cells.append(str(v))
        body.append("| " + " | ".join(cells) + " |")
    return head + "\n".join(body) + "\n"


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    def default(o: Any) -> Any:
        if isinstance(o, np.integer | np.floating):
            return o.item()
        if isinstance(o, np.ndarray | pd.Series):
            return None  # large arrays are not serialised into reports
        if isinstance(o, pd.Timestamp):
            return o.isoformat()
        return str(o)

    def clean(o: Any) -> Any:
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items() if not str(k).startswith("_")}
        if isinstance(o, list | tuple):
            return [clean(v) for v in o]
        if isinstance(o, float) and not np.isfinite(o):
            return None
        return o

    path.write_text(json.dumps(clean(obj), indent=2, default=default))
