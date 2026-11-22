.PHONY: install init-db data test test-fast lint typecheck walk-forward report paper paper-smoke dashboard frontend docker audit

install:            ## install pinned Python deps (uv.lock) + frontend deps
	uv sync --frozen
	cd dashboard/frontend && npm ci

init-db:
	uv run python scripts/init_db.py

data:               ## download / incrementally update >=3y OHLCV + funding, write coverage report
	uv run python scripts/download_data.py

test:               ## full automated test suite (no network, no real orders)
	uv run pytest -q

lint:
	uv run ruff check quant_engine scripts tests

typecheck:
	uv run mypy quant_engine

walk-forward:       ## walk-forward research + promotion + Monte Carlo + frozen holdout -> artifacts/research
	uv run python scripts/run_walk_forward.py

report:
	uv run python scripts/generate_report.py

paper:              ## paper trading with live public data + dashboard on 127.0.0.1:8000
	uv run python scripts/run_paper_trading.py --with-dashboard

paper-smoke:        ## 60 s smoke test incl. a labelled diagnostic probe order
	uv run python scripts/run_paper_trading.py --duration 60 --poll 5 --diagnostic-probe

dashboard:
	uv run python scripts/run_dashboard.py

frontend:
	cd dashboard/frontend && npm ci && npm run build

docker:
	docker compose build

audit:              ## dependency vulnerability scan
	uv run pip-audit
	cd dashboard/frontend && npm audit --omit=dev
