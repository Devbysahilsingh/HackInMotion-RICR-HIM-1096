import { type Page } from '@playwright/test';

import { expect, test } from './fixtures';

import { API_BASE, navigateTo, openApp } from './support';

/**
 * Journey 2 — the API-down loop (docs/testing/e2e-testing.md).
 *
 * "seed cache → enable failure → login → every P0 screen renders cached data +
 *  correct labels → no blank/broken states anywhere."
 *
 * This is the test that proves the resilience story is real rather than
 * aspirational (ADR-008, cache-first). The pattern in each case is: load the
 * screen once so React Query holds the data, then take the API away and force
 * a refetch. What must happen is the cached content staying on screen behind a
 * banner — not an error page, and never a blank.
 *
 * The auth path is deliberately left working: a farmer whose session dies has
 * a different, already-tested experience, and killing it here would only test
 * the login redirect twice.
 */
const P0_SCREENS = [
  { name: 'farms', path: '/farms', inNav: true },
  { name: 'market', path: '/market', inNav: true },
  { name: 'community', path: '/community', inNav: true },
  { name: 'scan', path: '/scan', inNav: true },
  { name: 'settings', path: '/settings', inNav: true },
  { name: 'dashboard', path: '/dashboard', inNav: true },
  // Not in the primary nav — reached from links on other screens.
  { name: 'history', path: '/history', inNav: false },
  { name: 'crop recommendation', path: '/crop-recommendation', inNav: false },
];

/** Fails every data endpoint. Auth is exempt — see the note above. */
async function breakTheApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/**`, async (route) => {
    if (route.request().url().includes('/auth/')) return route.fallback();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'EXTERNAL_SERVICE_ERROR', messageKey: 'errors.internal' },
      }),
    });
  });
}

test.describe('API down', () => {
  test('every P0 screen renders a designed state, never a blank one', async ({ page }) => {
    await openApp(page);
    await breakTheApi(page);

    for (const screen of P0_SCREENS) {
      // Client-side navigation where the shell offers it: a document load
      // would re-run the auth bootstrap, and seven of those in one test eats
      // a serious share of the 60/hour refresh budget for no added coverage.
      if (screen.inNav) await navigateTo(page, screen.path);
      else await page.goto(screen.path);

      // Something designed is on screen: real data (from cache), a designed
      // empty state, or a designed error with a retry. Never nothing.
      const designed = page
        .getByTestId('error-state')
        .or(page.getByTestId('empty-state'))
        .or(page.getByTestId('stale-banner'))
        .or(page.getByTestId('feed-item'))
        .or(page.getByTestId('farm-list-item'))
        .or(page.getByTestId('community-privacy'))
        .or(page.getByTestId('croprec-wizard'))
        .or(page.getByRole('heading', { level: 1 }));

      await expect(designed.first(), `${screen.name} rendered nothing`).toBeVisible();

      // No raw failure ever reaches the farmer.
      const body = await page.locator('body').innerText();
      expect(body, `${screen.name} leaked a raw error`).not.toMatch(
        /EXTERNAL_SERVICE_ERROR|503|\[object Object\]|undefined|NaN/,
      );

      // And no unhandled crash.
      await expect(page.getByTestId('app-crash')).toHaveCount(0);
    }
  });

  test('keeps showing cached data behind a stale banner rather than an error page', async ({
    page,
  }) => {
    await openApp(page);

    // Warm the cache with a real response.
    await expect(page.getByTestId('crop-card').first()).toBeVisible();

    const items = page.getByTestId('feed-item');
    const before = await items.count();
    test.skip(before === 0, 'no active feed items — run `npm run jobs -- feedRefresh` first');

    /*
     * The refetch is driven by the acknowledge mutation's own invalidation
     * rather than by a synthetic focus event: `refetchOnWindowFocus` only
     * refetches a *stale* query, and the dashboard's 60s staleTime means a
     * just-loaded one is not. Letting the mutation trigger it is both
     * deterministic and the real sequence — a farmer taps "done", the
     * dashboard reloads, and the network happens to be gone.
     */
    await page.route(`${API_BASE}/dashboard`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'EXTERNAL_SERVICE_ERROR', messageKey: 'errors.internal' },
        }),
      }),
    );

    await items.first().getByTestId('feed-ack').click();

    await expect(page.getByTestId('stale-banner')).toBeVisible();
    // The point of the whole exercise: the data is still on screen.
    await expect(page.getByTestId('crop-card').first()).toBeVisible();
    await expect(page.getByTestId('error-state')).toHaveCount(0);
  });

  test('offers a retry that recovers once the API returns', async ({ page }) => {
    await openApp(page);

    let failing = true;
    await page.route(`${API_BASE}/farms`, async (route) => {
      if (!failing) return route.fallback();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'EXTERNAL_SERVICE_ERROR', messageKey: 'errors.internal' },
        }),
      });
    });

    await navigateTo(page, '/farms');
    const error = page.getByTestId('error-state');
    await expect(error).toBeVisible();

    failing = false;
    await error.getByRole('button').click();

    await expect(page.getByTestId('farm-list-item').first()).toBeVisible();
  });

  test('renders the failure states in Hindi too', async ({ page }) => {
    await openApp(page);

    await page.getByTestId('language-hi').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

    await breakTheApi(page);
    await navigateTo(page, '/farms');

    const designed = page.getByTestId('error-state').or(page.getByTestId('stale-banner'));
    await expect(designed.first()).toContainText(/[ऀ-ॿ]/);
  });
});
