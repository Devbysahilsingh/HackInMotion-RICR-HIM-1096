/**
 * The one axios instance.
 *
 * Structurally the same as the web client (web/frontend/src/api/client.ts):
 * bearer header, correlation id, single-flight refresh-on-401, one replay,
 * every failure normalised to `ApiError`. Two things genuinely differ, and
 * both come from the platform rather than from taste:
 *
 * 1. **No cookies.** The web keeps the refresh token in a path-scoped httpOnly
 *    cookie that script cannot read. React Native has no such thing, so the
 *    token is read out of SecureStore and sent in the request body — a shape
 *    `backend/src/routes/auth.js` supports on every route that takes one.
 * 2. **The rotated token has to be stored.** The browser is handed a new
 *    cookie by `Set-Cookie` and does the filing itself. Here, `/auth/refresh`
 *    returns the next refresh token in its body and dropping it would log the
 *    farmer out at the following rotation.
 *
 * Timeouts follow docs/mobile/api-integration.md: 15s default, 45s upload.
 */
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { ApiError, isApiErrorBody } from '@shared/client/errors';
import type { ApiMeta, ApiSuccess, RefreshResponse } from '@shared/types/api';

import { API_BASE_URL } from '../config/env';
import {
  clearRefreshToken,
  emitSessionLost,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './session';

/** 15s, per docs/mobile/api-integration.md. Uploads override to 45s. */
const REQUEST_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 45_000;

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

// ── Request: bearer token + correlation id ──────────────────────────────────

/**
 * A client-side correlation id, so a farmer-reported failure can be found in
 * the server log without asking them to read a stack trace. `crypto.randomUUID`
 * is not guaranteed on Hermes, so the fallback is not decorative.
 */
function newRequestId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

http.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers);
  const token = getAccessToken();

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', newRequestId());

  config.headers = headers;
  return config;
});

// ── Refresh: one in flight at a time ────────────────────────────────────────

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Rotates the refresh token and returns the new access token, or null if the
 * session is over.
 *
 * Single-flight: several requests that 401 together share one refresh call.
 * Without this the second and third would each present a token the first has
 * already rotated away, which the API's reuse detector correctly reads as
 * theft — killing the whole family and logging the farmer out for the crime of
 * being on a slow rural connection.
 *
 * The call goes out on a bare axios instance so it cannot recurse through this
 * interceptor.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const stored = await getRefreshToken();
      if (!stored) return null;

      const response = await axios.post<ApiSuccess<RefreshResponse>>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken: stored },
        {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { Accept: 'application/json', 'X-Request-Id': newRequestId() },
        },
      );

      const accessToken = response.data?.data?.accessToken ?? null;
      const rotated = response.data?.data?.refreshToken ?? null;

      // Store the rotated token before publishing the access token: if the
      // write fails we would rather fail this refresh than hand out a session
      // whose successor token has already been consumed server-side.
      if (rotated) await setRefreshToken(rotated);

      setAccessToken(accessToken);
      return accessToken;
    } catch (error) {
      setAccessToken(null);

      /**
       * Only a *refusal* ends the session.
       *
       * The web can treat every failure here as terminal, because a browser
       * that cannot reach the API is a browser with nothing cached to show. On
       * a phone the opposite is true: there is a persisted cache, the farmer is
       * standing in a field, and the radio drops constantly. Destroying the
       * refresh token because a request timed out would take the one credential
       * that could have resumed the session and leave a device full of readable
       * data sitting on a login form it cannot complete (RES-11 —
       * docs/offline: "not a logout wipe").
       *
       * So the token is cleared only when the server actually answered and
       * said no. A transport failure — no response at all, a timeout, DNS,
       * a captive portal — leaves it alone and returns null, and the caller
       * falls back to the cached read-only view until connectivity returns.
       *
       * This does not weaken the security story: which *kind* of 4xx is still
       * never distinguished for the caller, so a revoked family, an expired
       * token and an unknown one remain indistinguishable on the wire.
       */
      const refused = axios.isAxiosError(error) && error.response != null;

      if (refused) await clearRefreshToken();

      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ── Response: replay once, then normalise ───────────────────────────────────

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) throw toApiError(error);

    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status ?? null;
    const isRefreshCall = config?.url?.includes('/auth/refresh') ?? false;

    if (status === 401 && config != null && !config._retriedAfterRefresh && !isRefreshCall) {
      const token = await refreshSession();

      if (token) {
        config._retriedAfterRefresh = true;
        const headers = AxiosHeaders.from(config.headers);
        headers.set('Authorization', `Bearer ${token}`);
        config.headers = headers;
        return http.request(config);
      }

      emitSessionLost('refresh_failed');
    }

    throw toApiError(error);
  },
);

/**
 * `Retry-After`, in seconds.
 *
 * `middleware/rateLimits.js` sends it as a whole number of seconds, which is
 * the only form read here — the HTTP-date form is legal but the API never
 * emits it, and guessing at a clock skew would produce a worse number than
 * showing none.
 */
function parseRetryAfter(headers: unknown): number | null {
  if (typeof headers !== 'object' || headers === null) return null;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** Axios/network failure → `ApiError`, with a key that exists in `errors.json`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    const status = axiosError.response?.status ?? null;
    const body = axiosError.response?.data;

    if (isApiErrorBody(body)) {
      return new ApiError({
        code: body.error.code,
        messageKey: body.error.messageKey,
        status,
        details: body.error.details,
        retryAfterSeconds: parseRetryAfter(axiosError.response?.headers),
      });
    }

    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      return new ApiError({ code: 'TIMEOUT', messageKey: 'errors.network', status });
    }
    if (axiosError.code === 'ERR_CANCELED') {
      return new ApiError({ code: 'CANCELLED', messageKey: 'errors.network', status });
    }
    if (!axiosError.response) {
      return new ApiError({ code: 'NETWORK_ERROR', messageKey: 'errors.network', status: null });
    }

    // A status with no recognisable envelope — a proxy error page, an HTML 502.
    return new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal', status });
  }

  return new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal' });
}

// ── Typed helpers ───────────────────────────────────────────────────────────

/**
 * Unwraps the success envelope. A body that is not the documented envelope is
 * a contract break and is raised as one rather than handed to a screen as
 * `undefined`.
 */
function unwrap<T>(body: unknown): T {
  if (typeof body === 'object' && body !== null && (body as ApiSuccess<T>).success === true) {
    return (body as ApiSuccess<T>).data;
  }
  throw new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal' });
}

export interface Paged<T> {
  data: T;
  meta: ApiMeta;
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return unwrap<T>((await http.get(url, config)).data);
}

export async function apiGetPaged<T>(url: string, config?: AxiosRequestConfig): Promise<Paged<T>> {
  const body = (await http.get(url, config)).data;
  return { data: unwrap<T>(body), meta: (body as ApiSuccess<T>).meta ?? {} };
}

export async function apiPost<T>(
  url: string,
  payload?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>((await http.post(url, payload, config)).data);
}

export async function apiPatch<T>(
  url: string,
  payload?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  return unwrap<T>((await http.patch(url, payload, config)).data);
}

/** 204 endpoints. There is no envelope to unwrap. */
export async function apiPostNoContent(
  url: string,
  payload?: unknown,
  config?: AxiosRequestConfig,
): Promise<void> {
  await http.post(url, payload, config);
}

export async function apiDelete(url: string, config?: AxiosRequestConfig): Promise<void> {
  await http.delete(url, config);
}
