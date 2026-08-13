import { type Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  JPEG_FIXTURE,
  confidentLog,
  navigateTo,
  openApp,
  stubAnalyze,
  stubHealthLog,
  uncertainLog,
} from './support';

/**
 * Journey 1 — the full farmer loop (docs/testing/e2e-testing.md).
 *
 * Runs against the real backend and the real engines on real Open-Meteo
 * weather. Only the crop-health verdict is substituted, and only at the API
 * boundary — the upload, the multipart request, the routing and every branch
 * of the result page are exercised for real.
 *
 * The journey is split across several tests rather than one long script: they
 * share one signed-in browser (see `fixtures.ts`), so splitting costs nothing
 * and a failure names the step that broke instead of pointing at a 60-second
 * timeout somewhere in the middle.
 *
 * Navigation goes through the app's own links wherever possible. That is not
 * cosmetic: a full document load re-runs the auth bootstrap, and the refresh
 * limiter allows 60 an hour per IP.
 */
test.describe('farmer loop', () => {
  test('dashboard shows engine verdicts with their numbers', async ({ page }) => {
    await openApp(page);

    const feedItems = page.getByTestId('feed-item');
    await expect(feedItems.first()).toBeVisible();

    // Priority is chipped with icon + text, never colour alone.
    await expect(feedItems.first().getByTestId('priority-chip')).toBeVisible();

    // The explainability promise (R12), inline and carrying real numbers.
    await feedItems.first().getByTestId('why-toggle').click();
    const trace = feedItems.first().getByTestId('why-trace');
    await expect(trace).toBeVisible();
    await expect(trace).toContainText(/[0-9]/);

    // Crop cards, each labelled with how fresh the weather behind it is.
    const cropCard = page.getByTestId('crop-card').first();
    await expect(cropCard).toBeVisible();
    await expect(cropCard.getByTestId('freshness-dot')).toBeVisible();
  });

  test('records a watering and shows fertilizer guidance with its disclaimer', async ({ page }) => {
    await openApp(page);

    await page.getByTestId('crop-card').first().locator('a').first().click();
    await expect(page).toHaveURL(/\/crops\//);

    await page.getByRole('tab', { name: /irrigation/i }).click();
    await expect(page.getByTestId('irrigation-verdict')).toBeVisible();

    await page.getByTestId('irrigation-log-date').fill(new Date().toISOString().slice(0, 10));
    await page.getByTestId('irrigation-log-amount').fill('20');
    await page.getByTestId('irrigation-log-submit').click();

    // The ledger anchors the water-balance replay, so the entry must land.
    await expect(page.getByTestId('irrigation-ledger')).toContainText('20');

    await page.getByRole('tab', { name: /fertilizer/i }).click();
    // Unconditional by contract — every fertilizer response carries it.
    await expect(page.getByTestId('fertilizer-disclaimer')).toBeVisible();
  });

  test('reaches every P0 surface through the app navigation', async ({ page }) => {
    await openApp(page);

    await navigateTo(page, '/market');
    await expect(
      page.getByTestId('market-signal').or(page.getByTestId('empty-state')).first(),
    ).toBeVisible();

    await navigateTo(page, '/farms');
    await page.getByTestId('farm-list-item').first().click();
    await expect(
      page.getByTestId('forecast-strip').or(page.getByTestId('notice')).first(),
    ).toBeVisible();

    await navigateTo(page, '/community');
    await expect(page.getByTestId('community-privacy')).toBeVisible();

    await navigateTo(page, '/dashboard');
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
  });

  test('runs the crop-recommendation wizard end to end', async ({ page }) => {
    await openApp(page, '/crop-recommendation');
    await expect(page.getByTestId('croprec-wizard')).toBeVisible();

    // Step 1 — field.
    await page.getByRole('radio').first().check();
    await page.getByTestId('croprec-next').click();

    // Step 2 — season.
    await page.getByRole('radio').first().check();
    await page.getByTestId('croprec-next').click();

    // Step 3 — preference is pre-selected; run it.
    await page.getByTestId('croprec-run').click();

    await expect(page.getByTestId('croprec-result')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /suggested crops|ruled out/i }).first(),
    ).toBeVisible();
  });

  test('switches the whole shell between English and Hindi', async ({ page }) => {
    await openApp(page);

    await page.getByTestId('language-hi').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByTestId('priority-chip').first()).toContainText(/[ऀ-ॿ]/);

    await page.getByTestId('language-en').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('priority-chip').first()).not.toContainText(/[ऀ-ॿ]/);
  });

  test('acknowledging an item removes it, and it stays gone after a reload', async ({ page }) => {
    await openApp(page);

    const items = page.getByTestId('feed-item');
    const before = await items.count();
    test.skip(before === 0, 'no active feed items — run `npm run jobs -- feedRefresh` first');

    await items.first().getByTestId('feed-ack').click();
    await expect(items).toHaveCount(before - 1);

    // Persisted server-side, not merely hidden optimistically. This reload is
    // the assertion, so it earns its bootstrap.
    await page.reload();
    await expect(page.getByTestId('feed-item')).toHaveCount(before - 1);
  });

  test('restores the session across a browser refresh', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('crop-card').first()).toBeVisible();

    await page.reload();

    // The most noticeable auth bug there is: a reload must not sign the farmer
    // out. The whole session rests on the silent bootstrap here.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('crop-card').first()).toBeVisible();
  });
});

/** The scan flow, across the documented result branches. */
test.describe('scan flow', () => {
  test('confident branch renders diagnosis, confidence and guidance', async ({ page }) => {
    const cropId = await firstCropId(page);
    await stubAnalyze(page, confidentLog(cropId));
    await stubHealthLog(page, 'e2e-confident', confidentLog(cropId));

    await navigateTo(page, '/scan');
    await page.getByTestId('scan-crop').selectOption(cropId);
    await page.getByTestId('upload-input').setInputFiles(JPEG_FIXTURE);
    await expect(page.getByTestId('upload-preview')).toBeVisible();

    await page.getByTestId('scan-submit').click();

    await expect(page).toHaveURL(/\/health\//);
    await expect(page.getByTestId('analysis-result')).toHaveAttribute('data-unknown', 'false');
    await expect(page.getByTestId('disease-name')).toBeVisible();
    await expect(page.getByTestId('source-label')).toContainText(/Local AI/i);
    await expect(page.getByTestId('confidence-value')).toContainText('93%');
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await expect(page.getByTestId('severity-badge')).toContainText(/assessed/i);
  });

  test('uncertain branch offers a retake and the guided route, not a diagnosis', async ({
    page,
  }) => {
    const cropId = await firstCropId(page);
    await stubAnalyze(page, uncertainLog(cropId));
    await stubHealthLog(page, 'e2e-uncertain', uncertainLog(cropId));

    await navigateTo(page, '/scan');
    await page.getByTestId('scan-crop').selectOption(cropId);
    await page.getByTestId('upload-input').setInputFiles(JPEG_FIXTURE);
    await page.getByTestId('scan-submit').click();

    await expect(page).toHaveURL(/\/health\//);
    await expect(page.getByTestId('analysis-result')).toHaveAttribute('data-unknown', 'true');
    // Specifically: no condition is named.
    await expect(page.getByTestId('disease-name')).toHaveCount(0);
    await expect(page.getByTestId('uncertain-branch')).toBeVisible();
    await expect(page.getByTestId('expert-referral')).toContainText(/1800-180-1551/);
  });

  test('error branch keeps the farmer on the form with a localized message', async ({ page }) => {
    const cropId = await firstCropId(page);

    await page.route('**/crop-health/analyze', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'EXTERNAL_SERVICE_ERROR', messageKey: 'errors.uploadStorageUnavailable' },
        }),
      }),
    );

    await navigateTo(page, '/scan');
    await page.getByTestId('scan-crop').selectOption(cropId);
    await page.getByTestId('upload-input').setInputFiles(JPEG_FIXTURE);
    await page.getByTestId('scan-submit').click();

    const error = page.getByTestId('scan-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/could not save your photo/i);
    // Not stranded — the form is still there and still submittable.
    await expect(page.getByTestId('scan-submit')).toBeEnabled();
  });

  test('guided symptom check answers without a photo', async ({ page }) => {
    await openApp(page, '/scan/symptoms');

    await page.getByTestId('symptom-crop').selectOption({ index: 1 });
    await page.getByTestId('symptom-part').selectOption('LEAF');
    await page.getByTestId('symptom-pattern').selectOption('SPOTS');
    await page.getByTestId('symptom-color').selectOption('BROWN');
    await page.getByTestId('symptom-submit').click();

    // Candidates or an honest referral — both are designed outcomes, and the
    // engine is required to prefer the referral over a low-scoring guess.
    await expect(
      page
        .getByTestId('symptom-candidate')
        .first()
        .or(page.getByTestId('symptom-referral'))
        .first(),
    ).toBeVisible();
  });
});

/**
 * Reads a real crop id off the dashboard rather than hardcoding a fixture id,
 * and leaves the page on the dashboard so the caller can click through to the
 * scan screen without another document load.
 */
async function firstCropId(page: Page): Promise<string> {
  await openApp(page);
  const card = page.getByTestId('crop-card').first();
  await expect(card).toBeVisible();
  const href = await card.locator('a').first().getAttribute('href');
  const id = href?.split('/crops/')[1]?.split('?')[0];
  expect(id).toBeTruthy();
  return id!;
}
