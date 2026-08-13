import { expect, type Page, type Route } from '@playwright/test';

/**
 * Shared E2E helpers.
 *
 * The credentials come from the environment so the suite never carries a
 * password of its own; `scripts/setup-dev-env.mjs` writes the same pair into
 * `backend/.env`, and `npm run seed:dev` creates the account.
 */
export const DEMO_EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com';
export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? 'demo-farmer-2026';

export const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Opens a route with a **full document load**, in the already-signed-in
 * context (see `fixtures.ts`).
 *
 * ## Use this sparingly
 *
 * Every full load re-runs the silent bootstrap, and every bootstrap rotates
 * the refresh token against a 60-per-hour-per-IP limiter (`refreshLimiter`).
 * That is generous for a farmer, who reloads a handful of times a day, and
 * far too tight for a suite that `goto`s ten times per test — the later tests
 * simply get 429s and appear to be signed out.
 *
 * So: one `openApp` per test, then move around with `navigateTo` and in-page
 * links, which is also how the app is actually used.
 */
export async function openApp(page: Page, path = '/dashboard'): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('auth-bootstrapping')).toHaveCount(0, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Moves between sections through the app's own navigation — a client-side
 * route change, with no document load and therefore no token rotation.
 *
 * The shell renders the same link twice: once in the desktop sidebar (first
 * in DOM, `display:none` under 768px) and once in the mobile bottom tabs.
 * `.first()` therefore resolved to an invisible element on the mobile
 * project and every navigation timed out — filter to the *visible* one.
 */
export async function navigateTo(page: Page, href: string): Promise<void> {
  await page.locator(`nav a[href="${href}"]`).locator('visible=true').first().click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, '\\/')}$`));
}

/**
 * Substitutes the crop-health analyze response.
 *
 * The AI tiers are the one thing that cannot run for real in a test: the local
 * model needs a photograph of an actual diseased leaf to say anything true,
 * and Cloudinary is not configured locally, so a real upload is refused before
 * analysis is even attempted. Everything *around* the analysis — the multipart
 * request, the ownership check, the rate limiter, the router, and every branch
 * of the result page — is exercised for real.
 *
 * The fixtures are shaped exactly as `presentLog()` serialises a log.
 */
export async function stubAnalyze(page: Page, log: unknown): Promise<void> {
  await page.route(`${API_BASE}/crop-health/analyze`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { log } }),
    });
  });
}

export async function stubHealthLog(page: Page, logId: string, log: unknown): Promise<void> {
  await page.route(`${API_BASE}/crop-health/logs/${logId}`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { log } }),
    });
  });
}

/** A tiny valid JPEG, so the browser's file input accepts a real image. */
export const JPEG_FIXTURE = {
  name: 'leaf.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
};

const BRANCH_BASE = {
  cropId: '',
  imageUrl: '',
  description: null,
  status: 'analyzed',
  sharedToCommunity: false,
  createdAt: new Date().toISOString(),
  severityFollowUp: null,
  coverageNoticeKey: null,
  freshness: { status: 'live', source: 'ml', fetchedAt: new Date().toISOString() },
};

/** The confident branch: a named condition with knowledge-base guidance. */
export const confidentLog = (cropId: string) => ({
  ...BRANCH_BASE,
  id: 'e2e-confident',
  cropId,
  analysis: {
    source: 'ml',
    sourceLabelKey: 'health.sourceLocalAi',
    diseaseCode: 'TOMATO_EARLY_BLIGHT',
    confidence: 0.93,
    severityAssessment: 'MODERATE',
    escalated: false,
    modelVersion: 'model-v1.0',
    top3: [{ code: 'TOMATO_EARLY_BLIGHT', prob: 0.93 }],
    escalationPath: [{ tier: 'ml', outcome: 'answered', reasonCode: 'CONFIDENT' }],
  },
  recommendation: {
    titleKey: 'health.titleMl',
    data: {
      diseaseCode: 'TOMATO_EARLY_BLIGHT',
      source: 'ml',
      confidenceKind: 'CALIBRATED',
      confidenceBand: null,
      severity: 'MODERATE',
      severityPolicy: 'ENGINE_ASSESSED',
      escalated: false,
      symptomKeys: ['disease.TOMATO_EARLY_BLIGHT.symptom.1'],
      inspectKeys: ['disease.TOMATO_EARLY_BLIGHT.inspect.1'],
      nextStepKeys: ['disease.TOMATO_EARLY_BLIGHT.nextStep.1'],
      preventionKeys: ['disease.TOMATO_EARLY_BLIGHT.prevention.1'],
      sourceRefs: [{ org: 'TNAU', title: 'Tomato early blight' }],
      aiObservations: [],
      imageAssessment: 'OK',
      supportLevel: 'SPECIALIZED',
      severityTrace: [{ step: 'SEVERITY', severityVisual: 'MODERATE' }],
      generatedAt: new Date().toISOString(),
    },
  },
});

/** The uncertain branch: no tier could name it. An outcome, not a failure. */
export const uncertainLog = (cropId: string) => ({
  ...BRANCH_BASE,
  id: 'e2e-uncertain',
  cropId,
  analysis: {
    source: 'rules',
    sourceLabelKey: 'health.sourceGuided',
    diseaseCode: 'UNKNOWN',
    confidence: 0.28,
    severityAssessment: 'NOT_ASSESSED',
    escalated: true,
    modelVersion: 'model-v1.0',
    top3: [],
    escalationPath: [
      { tier: 'ml', outcome: 'declined', reasonCode: 'BELOW_TAU' },
      { tier: 'gemini', outcome: 'skipped', reasonCode: 'NOT_CONFIGURED' },
      { tier: 'rules', outcome: 'declined', reasonCode: 'NO_SYMPTOMS_ANSWERED' },
    ],
  },
  recommendation: {
    titleKey: 'health.titleUnknown',
    data: {
      diseaseCode: 'UNKNOWN',
      source: 'rules',
      confidenceKind: 'MATCH_SCORE',
      confidenceBand: 'LOW',
      severity: 'NOT_ASSESSED',
      severityPolicy: 'NOT_ASSESSABLE',
      escalated: true,
      symptomKeys: [],
      inspectKeys: [],
      nextStepKeys: [],
      preventionKeys: [],
      sourceRefs: [],
      aiObservations: [],
      imageAssessment: 'OK',
      supportLevel: 'SPECIALIZED',
      severityTrace: [],
      generatedAt: new Date().toISOString(),
    },
  },
});
