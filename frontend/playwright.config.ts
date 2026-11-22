import { defineConfig } from '@playwright/test'

const PORT = 8011

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1600, height: 950 }, trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: `bash -c "rm -f /tmp/ih-e2e.db* && cd ../backend && IH_DB=/tmp/ih-e2e.db .venv/bin/uvicorn app.main:app --port ${PORT}"`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
