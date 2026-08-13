import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

import { API_BASE_URL } from '@/api/client';
import * as fixtures from './fixtures';

/**
 * The mock API.
 *
 * msw intercepts at the network layer, so the axios instance under test runs
 * its real interceptors: the bearer header is attached, a 401 triggers the
 * single-flight refresh, and failures are normalised into `ApiError`. Stubbing
 * the module instead would skip exactly the code most worth testing.
 *
 * Responses are wrapped in the documented envelope, because that is what the
 * client has to unwrap.
 */
const url = (path: string): string => `${API_BASE_URL}${path}`;

export const ok = <T>(data: T, meta?: Record<string, unknown>) =>
  HttpResponse.json({ success: true, data, ...(meta ? { meta } : {}) });

export const fail = (status: number, code: string, messageKey: string, details?: unknown[]) =>
  HttpResponse.json(
    { success: false, error: { code, messageKey, ...(details ? { details } : {}) } },
    { status },
  );

/** The signed-in happy path. Individual tests override what they care about. */
export const handlers = [
  http.post(url('/auth/refresh'), () =>
    ok({ accessToken: fixtures.session.accessToken, refreshToken: fixtures.session.refreshToken }),
  ),
  http.post(url('/auth/login'), () => ok(fixtures.session)),
  http.post(url('/auth/register'), () => ok(fixtures.session, undefined)),
  http.post(url('/auth/logout'), () => new HttpResponse(null, { status: 204 })),
  http.get(url('/auth/me'), () => ok({ user: fixtures.user })),

  http.get(url('/dashboard'), () => ok(fixtures.dashboard)),
  http.post(url('/recommendations/:id/ack'), () => new HttpResponse(null, { status: 204 })),
  http.get(url('/recommendations'), () =>
    ok({ recommendations: fixtures.dashboard.feed }, { page: 1, limit: 20, total: 2 }),
  ),

  http.get(url('/farms'), () => ok({ farms: [fixtures.farm] })),
  http.get(url('/farms/:id'), () => ok({ farm: fixtures.farm, crops: [fixtures.crop] })),
  http.post(url('/farms'), () => ok({ farm: fixtures.farm })),
  http.patch(url('/farms/:id'), () => ok({ farm: fixtures.farm })),
  http.get(url('/farms/:id/weather'), () => ok(fixtures.farmWeather)),
  http.get(url('/farms/:farmId/crops'), () => ok({ crops: [fixtures.crop] })),
  http.post(url('/farms/:farmId/crops'), () => ok({ crop: fixtures.crop })),

  http.get(url('/crops/:id'), () => ok({ crop: fixtures.crop, registry: null })),
  http.get(url('/crops/:id/irrigation'), () => ok(fixtures.irrigationAdvice)),
  http.get(url('/crops/:id/irrigation-log'), () =>
    ok({ logs: [] }, { page: 1, limit: 20, total: 0 }),
  ),
  http.post(url('/crops/:id/irrigation-log'), () =>
    ok({ log: { id: 'log1', date: new Date().toISOString(), amountMm: 25, source: 'manual' } }),
  ),
  http.get(url('/crops/:id/fertilizer-guidance'), () => ok(fixtures.fertilizerGuidance)),

  http.get(url('/registry/crops'), ({ request }) => {
    const code = new URL(request.url).searchParams.get('code');
    if (code) return ok({ crop: { cropCode: code, names: { en: code, hi: code }, diseases: [] } });
    return ok({ crops: fixtures.registryCrops }, { total: fixtures.registryCrops.length });
  }),

  http.get(url('/crop-health/logs'), () => ok({ logs: [] }, { page: 1, limit: 20, total: 0 })),
  http.get(url('/crop-health/logs/:id'), () => ok({ log: fixtures.confidentLog })),
  http.post(url('/crop-health/analyze'), () => ok({ log: fixtures.confidentLog })),
  http.post(url('/crop-health/symptom-check'), () => ok(fixtures.symptomCheck)),

  http.get(url('/market/my-crops'), () =>
    ok({ crops: fixtures.myCropSignals }, { total: fixtures.myCropSignals.length }),
  ),
  http.get(url('/market/prices'), () => ok(fixtures.priceSeries)),

  http.get(url('/community/alerts'), () => ok({ alerts: fixtures.communityAlerts })),
  http.post(url('/crop-recommendation'), () => ok(fixtures.cropRecommendation)),
];

export const server = setupServer(...handlers);
export { url, http, HttpResponse };
