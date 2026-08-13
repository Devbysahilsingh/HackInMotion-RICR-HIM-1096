import { expect, test } from '@playwright/test';

import { DEMO_EMAIL, DEMO_PASSWORD } from './support';

/**
 * The unauthenticated half of the journey.
 *
 * These use Playwright's own `test` rather than the shared authenticated
 * fixture, because each needs a browser that starts signed **out** — and
 * because logging out has to happen in a context nobody else is using: the
 * fixture's context is shared across the whole worker, and revoking its
 * refresh family mid-run would sign every later test out.
 *
 * Between them they spend two of the login limiter's five attempts per
 * fifteen minutes, which is the budget this suite is designed around.
 */
test.describe('guards', () => {
  test('sends a visitor to login and back to where they asked for', async ({ page }) => {
    await page.goto('/market');
    await expect(page).toHaveURL(/\/login/);

    await page.getByTestId('email-input').fill(DEMO_EMAIL);
    await page.getByTestId('password-input').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();

    // The intent URL survives the bounce — the farmer lands where they asked
    // to go, not on a generic dashboard.
    await expect(page).toHaveURL(/\/market/);
  });

  test('signs out, and the session is really gone', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill(DEMO_EMAIL);
    await page.getByTestId('password-input').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/settings');
    await page.getByTestId('logout-button').click();
    await page
      .getByTestId('modal')
      .getByRole('button', { name: /sign out/i })
      .click();

    await expect(page).toHaveURL(/\/login/);

    // Not just a redirect: the refresh cookie was revoked, so the silent
    // bootstrap cannot bring the session back.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows a designed 404 with a way home', async ({ page }) => {
    await page.goto('/no-such-page');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Localized, with a route out — never a bare browser error page.
    await expect(page.getByRole('link').first()).toBeVisible();
  });

  test('renders the login screen in Hindi', async ({ page }) => {
    await page.goto('/login');

    await page.getByTestId('language-hi').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/[ऀ-ॿ]/);
  });
});
