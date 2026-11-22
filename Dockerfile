# syntax=docker/dockerfile:1.7
# ---------- frontend build ----------
FROM node:22.11-bookworm-slim AS frontend
WORKDIR /fe
COPY dashboard/frontend/package.json dashboard/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/frontend/ ./
RUN npm run build

# ---------- python runtime ----------
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir uv==0.5.11 && useradd --create-home --uid 10001 quant
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY quant_engine/ quant_engine/
COPY scripts/ scripts/
COPY --from=frontend /fe/dist dashboard/frontend/dist
RUN uv sync --frozen --no-dev && mkdir -p /app/var /app/logs /app/artifacts && chown -R quant:quant /app
USER quant
# PAPER is the default; LIVE additionally needs the acknowledgement phrase and the deployment gate file.
ENV PAPER_MODE=true LIVE_TRADING_ENABLED=false DASHBOARD_HOST=0.0.0.0
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health/live')"
CMD ["python", "scripts/run_paper_trading.py", "--with-dashboard"]
