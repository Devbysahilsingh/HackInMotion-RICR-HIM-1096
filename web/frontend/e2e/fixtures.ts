import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { DEMO_EMAIL, DEMO_PASSWORD } from './support';

/**
 * One authenticated browser context per worker.
 *
 * ## Why not `storageState`
 *
 * The obvious approach — sign in once in a setup project, save the cookies,
 * and start every test from that file — **cannot work against this API**, and
 * failing to notice that would have looked like a flaky suite.
 *
 * Refresh tokens rotate on every use and the server runs reuse detection: a
 * token that is presented twice is treated as stolen, and the whole family is
 * killed (`rotateRefreshToken`, `REFRESH_RESULT.REUSED`). Replaying one saved
 * cookie into a fresh context per test does exactly that — the first test
 * rotates it, the second replays the dead one, and from there every test is
 * signed out. The security control is right; the test shape was wrong.
 *
 * ## Why not log in per test
 *
 * `loginLimiter` allows 5 attempts per 15 minutes keyed on IP **and** email,
 * and it runs locally because the demo runs the production security config
 * (CLAUDE.md rule 2). A dozen logins would spend that in the first minute.
 *
 * ## What this does instead
 *
 * Signs in once per worker and keeps that context alive for the whole run, so
 * the rotating token chain stays intact inside a single browser exactly as it
 * would for a real farmer. Route stubs are torn down after each test so one
 * test's substituted endpoint cannot leak into the next.
 */
interface WorkerFixtures {
  authedContext: BrowserContext;
}

interface TestFixtures {
  page: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto('/login');
      await page.getByTestId('email-input').fill(DEMO_EMAIL);
      await page.getByTestId('password-input').fill(DEMO_PASSWORD);
      await page.getByTestId('login-submit').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

      await use(context);

      await context.close();
    },
    { scope: 'worker' },
  ],

  page: async ({ authedContext }, use) => {
    const page = authedContext.pages()[0] ?? (await authedContext.newPage());

    await use(page);

    // Route handlers are context-wide and would otherwise survive into the
    // next test, silently stubbing an endpoint it expects to be real.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  },
});

export { expect };
