import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config (docs/testing/e2e-testing.md).
 *
 * Two journeys, chromium plus a mobile viewport. The suite runs against the
 * **real local stack** — a real Express server, a real mongod, the real
 * engines — because the whole point of these tests is to catch the things that
 * only break when the pieces are wired together. Only the crop-health AI
 * verdict is substituted, and that at the API boundary rather than inside the
 * app.
 *
 * Authentication is handled by a worker-scoped fixture (`e2e/fixtures.ts`), not
 * by `storageState`: refresh tokens rotate and the server runs reuse detection,
 * so replaying one saved cookie into a fresh context per test trips the theft
 * alarm and signs the suite out. That file explains the constraint in full.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Serial: both journeys mutate one shared demo account, so parallel workers
  // would race each other's crops and ledger entries.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Selectors are `data-testid`, which survives a translation change — this
    // app switches language mid-journey, so text selectors would drift.
    testIdAttribute: 'data-testid',
  },

  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      /**
       * Guards run on desktop only. Their subject — redirects, session
       * revocation, the 404 — is viewport-independent, and each project run
       * of that spec spends two real logins against the 5-per-15-minute
       * limiter. Running it twice put the whole suite over the login budget:
       * the second project's fixture login answered 429, which cascaded into
       * every one of its tests failing at sign-in. The limiter is a security
       * control and stays exactly as it is (CLAUDE.md rule 2); the suite
       * spends less, not the server allowing more.
       */
      testIgnore: /guards\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
