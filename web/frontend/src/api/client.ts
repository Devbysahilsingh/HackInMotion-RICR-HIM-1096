/**
 * The one axios instance.
 *
 * Everything that talks to the API goes through here, so the auth header,
 * the refresh dance, the request id and error normalisation exist exactly
 * once (docs/frontend/architecture.md: "axios instance (interceptors: auth
 * header, refresh-on-401 single-flight, requestId)").
 *
 * ## Why credentials are per-request, not global
 *
 * `backend/src/app.js` mounts `cors({credentials:true})` **only** on
 * `/api/v1/auth`; every other route gets the same origin allowlist with
 * credentials off. Setting `withCredentials: true` globally would therefore
 * make the browser reject perfectly good responses from `/dashboard` and the
 * rest, because `Access-Control-Allow-Credentials` is absent there. The flag
 * is attached by `authRequest()` below, on the only path the refresh cookie is
 * scoped to.
 */
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { ApiError, isApiErrorBody } from './errors';
import { emitSessionLost, getAccessToken, setAccessToken } from './session';
import type { ApiMeta, ApiSuccess, RefreshResponse } from './types';

/** Vite injects this at build time; the dev default matches `backend/.env`. */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

const REQUEST_TIMEOUT_MS = 20_000;

/** Paths the refresh cookie is scoped to — the only ones that may send it. */
const AUTH_PATH_PREFIX = '/auth/';

/** Marks a config that has already been replayed once, so a loop is impossible. */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
  /** Set on the refresh call itself; a 401 there is terminal, never retried. */
  _isRefreshCall?: boolean;
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

// ── Request: bearer token + correlation id ──────────────────────────────────

/**
 * A client-side correlation id. The API generates its own when the header is
 * absent, so this is additive: it lets a farmer-reported failure be found in
 * the server log without asking them to read a stack trace.
 */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
 * session is truly over.
 *
 * Single-flight: three requests that 401 at the same moment share one refresh
 * call. Without this the second and third would each present the token the
 * first has already rotated away, which the API's reuse detector correctly
 * treats as theft — killing the whole family and logging the farmer out for
 * being on a slow connection.
 *
 * The call goes out on a bare axios instance, not `http`, so it cannot recurse
 * through this same interceptor.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await axios.post<ApiSuccess<RefreshResponse>>(
        `${API_BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          timeout: REQUEST_TIMEOUT_MS,
          headers: { Accept: 'application/json', 'X-Request-Id': newRequestId() },
        },
      );
      const token = response.data?.data?.accessToken ?? null;
      setAccessToken(token);
      return token;
    } catch {
      // Any failure here is the end of the session: the cookie is absent,
      // expired, or was rotated away. Distinguishing the cases would tell an
      // attacker which, and would change nothing for the farmer.
      //
      // The in-memory token is dropped rather than left behind. Whatever is
      // still held cannot be valid — the cookie backing it was just refused —
      // and leaving it would let the next request go out with a dead bearer
      // token instead of going out unauthenticated.
      setAccessToken(null);
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

    const canRetry =
      status === 401 && config != null && !config._retriedAfterRefresh && !config._isRefreshCall;

    if (canRetry) {
      const token = await refreshSession();

      if (token) {
        config._retriedAfterRefresh = true;
        const headers = AxiosHeaders.from(config.headers);
        headers.set('Authorization', `Bearer ${token}`);
        config.headers = headers;
        return http.request(config);
      }

      // Refresh is the last resort; once it fails the session is over.
      emitSessionLost('refresh_failed');
    }

    throw toApiError(error);
  },
);

/** Axios/network failure → `ApiError`, with a key that exists in `errors.json`. */
function toApiError(error: unknown): ApiError {
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

    // A response with a status but no recognisable envelope — a proxy error
    // page, an HTML 502. Reported as internal rather than echoed to the user.
    return new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal', status });
  }

  return new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal' });
}

// ── Typed helpers ───────────────────────────────────────────────────────────

/**
 * Unwraps the success envelope. Callers get `data` directly; a body that is
 * not the documented envelope is a contract break and is raised as one rather
 * than being handed to a component as `undefined`.
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

/** For endpoints whose pagination meta the caller needs alongside the rows. */
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

/** Adds the credentials flag the auth path — and only the auth path — needs. */
export function authRequest(config: AxiosRequestConfig = {}): AxiosRequestConfig {
  return { ...config, withCredentials: true };
}

export { AUTH_PATH_PREFIX, toApiError };
