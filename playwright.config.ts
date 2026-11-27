import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const runId = process.env.E2E_RUN_ID ?? `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
process.env.E2E_RUN_ID = runId;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && node dist/server/main.js',
    url: `http://127.0.0.1:${port}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      DB_SCHEMA: `e2e_${runId}`,
      COOKIE_SECURE: 'false',
      AI_MOVE_DELAY_MS: '50',
      POKER_BOT_DELAY_MS: '50',
      POKER_NEXT_HAND_DELAY_MS: '500',
      LOG_LEVEL: 'warn',
    },
  },
});
