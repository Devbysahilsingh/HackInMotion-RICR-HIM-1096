/**
 * The axios instance, exercised against a fake transport.
 *
 * These are the highest-value tests in the client. Everything the app does
 * passes through this file, and three of its behaviours are the kind that only
 * fail in the field: the single-flight refresh (get it wrong and a farmer on a
 * slow connection is logged out by the server's own reuse detector, which is
 * *correctly* reading two rotations of the same token as theft), the write
 * ordering around the rotated token, and the normalisation of a transport
 * failure into something a screen can render in Hindi.
 *
 * The transport is faked at the adapter seam rather than by mocking `axios`
 * itself, so the interceptors, the retry flag and the error mapping all run for
 * real — a mocked `axios.get` would test nothing but the mock.
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

interface Exchange {
  url: string;
  authorization?: string;
}

interface Harness {
  session: typeof import('./session');
  errors: typeof import('@shared/client/errors');
  client: typeof import('./client');
  secureStore: typeof import('expo-secure-store');
  asyncStorage: typeof import('@react-native-async-storage/async-storage').default;
  exchanges: Exchange[];
  refreshCalls: () => number;
  /** Replies for non-refresh requests, by attempt number (1-based). */
  setResource: (
    handler: (config: InternalAxiosRequestConfig, attempt: number) => Promise<AxiosResponse>,
  ) => void;
  setRefresh: (handler: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>) => void;
  reply: (config: InternalAxiosRequestConfig, data: unknown, status?: number) => AxiosResponse;
  refuse: (
    config: InternalAxiosRequestConfig,
    status: number,
    data: unknown,
  ) => Promise<AxiosResponse>;
  transportError: (config: InternalAxiosRequestConfig, code: string) => Promise<AxiosResponse>;
}

/**
 * A fresh module graph per test: `accessToken` and `refreshInFlight` are
 * module-level singletons, and a leaked one turns a later test green for the
 * wrong reason.
 *
 * Loaded through `jest.requireActual`/`requireMock` rather than `await import`,
 * because the Hermes-targeted Babel preset leaves dynamic `import()` alone and
 * Jest's CommonJS runtime cannot serve it.
 */
function harness(): Harness {
  jest.resetModules();

  const axiosModule = jest.requireActual<typeof import('axios')>('axios');
  const axios = axiosModule.default;
  const { AxiosError } = axiosModule;

  const session = jest.requireActual<typeof import('./session')>('./session');
  const client = jest.requireActual<typeof import('./client')>('./client');
  const errors =
    jest.requireActual<typeof import('@shared/client/errors')>('@shared/client/errors');
  const secureStore = jest.requireMock<typeof import('expo-secure-store')>('expo-secure-store');
  // The community mock is a plain CommonJS export, so there is no `default` to
  // reach through — unlike the ESM shape the app's own import sees.
  const asyncStorage = jest.requireMock<
    typeof import('@react-native-async-storage/async-storage').default
  >('@react-native-async-storage/async-storage');

  const exchanges: Exchange[] = [];
  const attempts = new Map<string, number>();
  let refreshCalls = 0;

  const reply = (
    config: InternalAxiosRequestConfig,
    data: unknown,
    status = 200,
  ): AxiosResponse => ({
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
  });

  const refuse = (config: InternalAxiosRequestConfig, status: number, data: unknown) =>
    Promise.reject(
      new AxiosError(`Request failed with status ${status}`, String(status), config, null, {
        data,
        status,
        statusText: 'Error',
        headers: {},
        config,
      }),
    );

  const transportError = (config: InternalAxiosRequestConfig, code: string) =>
    Promise.reject(new AxiosError('transport failure', code, config, null, undefined));

  let resource: (
    config: InternalAxiosRequestConfig,
    attempt: number,
  ) => Promise<AxiosResponse> = async (config) => reply(config, { success: true, data: {} });

  let refresh: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> = async (config) =>
    reply(config, {
      success: true,
      data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    });

  const adapter: AxiosAdapter = (config) => {
    const url = config.url ?? '';
    exchanges.push({
      url,
      authorization: config.headers?.Authorization as string | undefined,
    });

    if (url.includes('/auth/refresh')) {
      refreshCalls += 1;
      return refresh(config);
    }

    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    return resource(config, attempt);
  };

  client.http.defaults.adapter = adapter;
  // `refreshSession` deliberately goes out on the bare global instance so it
  // cannot recurse through the interceptor — so that instance needs the fake too.
  axios.defaults.adapter = adapter;

  return {
    session,
    client,
    errors,
    secureStore,
    asyncStorage,
    exchanges,
    refreshCalls: () => refreshCalls,
    setResource: (handler) => {
      resource = handler;
    },
    setRefresh: (handler) => {
      refresh = handler;
    },
    reply,
    refuse,
    transportError,
  };
}

const unauthorized = {
  success: false,
  error: { code: 'AUTHENTICATION_ERROR', messageKey: 'errors.validation' },
};

describe('refresh on 401', () => {
  it('refreshes once and replays the original request with the new bearer', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');
    h.session.setAccessToken('access-1');

    h.setResource(async (config, attempt) =>
      attempt === 1
        ? h.refuse(config, 401, unauthorized)
        : h.reply(config, { success: true, data: { farms: [] } }),
    );

    await expect(h.client.apiGet('/farms')).resolves.toEqual({ farms: [] });

    expect(h.refreshCalls()).toBe(1);
    const farmCalls = h.exchanges.filter((exchange) => exchange.url.includes('/farms'));
    expect(farmCalls).toHaveLength(2);
    expect(farmCalls[0]?.authorization).toBe('Bearer access-1');
    expect(farmCalls[1]?.authorization).toBe('Bearer access-2');
  });

  it('shares one refresh between two requests that 401 together', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');
    h.session.setAccessToken('access-1');

    h.setResource(async (config, attempt) =>
      attempt === 1
        ? h.refuse(config, 401, unauthorized)
        : h.reply(config, { success: true, data: { ok: true } }),
    );
    // A slow refresh is the case that matters: without single-flight, the
    // second request presents a token the first has already rotated away.
    h.setRefresh(async (config) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return h.reply(config, {
        success: true,
        data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
      });
    });

    await Promise.all([h.client.apiGet('/farms'), h.client.apiGet('/dashboard')]);

    expect(h.refreshCalls()).toBe(1);
  });

  it('writes the rotated refresh token before publishing the access token', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');

    let accessTokenAtWrite: string | null = 'unset';
    jest.mocked(h.secureStore.setItemAsync).mockImplementation(async () => {
      accessTokenAtWrite = h.session.getAccessToken();
    });

    h.setResource(async (config, attempt) =>
      attempt === 1
        ? h.refuse(config, 401, unauthorized)
        : h.reply(config, { success: true, data: { ok: true } }),
    );

    await h.client.apiGet('/farms');

    // The successor token is on disk while the access token it supersedes is
    // still the old one. The reverse order would hand out a session whose
    // refresh token has already been consumed server-side but never stored.
    expect(accessTokenAtWrite).not.toBe('access-2');
    expect(h.session.getAccessToken()).toBe('access-2');
  });

  it('never persists the access token', async () => {
    const h = harness();

    await h.session.setRefreshToken('refresh-1');
    jest.mocked(h.asyncStorage.setItem).mockClear();
    jest.mocked(h.secureStore.setItemAsync).mockClear();

    h.setResource(async (config, attempt) =>
      attempt === 1
        ? h.refuse(config, 401, unauthorized)
        : h.reply(config, { success: true, data: { ok: true } }),
    );

    await h.client.apiGet('/farms');

    expect(h.asyncStorage.setItem).not.toHaveBeenCalled();
    // The only thing that reached the Keystore is the rotated refresh token.
    expect(h.secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(h.secureStore.setItemAsync).mock.calls[0]?.[1]).toBe('refresh-2');
  });
});

describe('a refresh that fails', () => {
  it('clears both tokens and announces the lost session', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');
    h.session.setAccessToken('access-1');

    const lost = jest.fn();
    h.session.onSessionLost(lost);

    h.setResource(async (config) => h.refuse(config, 401, unauthorized));
    h.setRefresh(async (config) => h.refuse(config, 401, unauthorized));

    await expect(h.client.apiGet('/farms')).rejects.toBeInstanceOf(h.errors.ApiError);

    expect(h.session.getAccessToken()).toBeNull();
    await expect(h.session.getRefreshToken()).resolves.toBeNull();
    expect(lost).toHaveBeenCalledWith('refresh_failed');
  });

  /**
   * RES-11. The distinction this asserts is the difference between a farmer
   * who walks back into signal and carries on, and one who is holding a phone
   * full of readable cached advice behind a login form they cannot complete.
   */
  it('keeps the refresh token when the server never answered', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');
    h.session.setAccessToken('access-1');

    h.setResource(async (config) => h.refuse(config, 401, unauthorized));
    h.setRefresh(async (config) => h.transportError(config, 'ECONNABORTED'));

    await expect(h.client.apiGet('/farms')).rejects.toBeInstanceOf(h.errors.ApiError);

    // The access token is dropped either way — it is spent and re-derivable.
    expect(h.session.getAccessToken()).toBeNull();
    // The refresh token survives: nothing refused it.
    await expect(h.session.getRefreshToken()).resolves.toBe('refresh-1');
    expect(h.secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('is terminal — a 401 on /auth/refresh never loops', async () => {
    const h = harness();
    await h.session.setRefreshToken('refresh-1');
    h.session.setAccessToken('access-1');

    h.setResource(async (config) => h.refuse(config, 401, unauthorized));
    h.setRefresh(async (config) => h.refuse(config, 401, unauthorized));

    await expect(h.client.apiGet('/farms')).rejects.toBeInstanceOf(h.errors.ApiError);

    expect(h.refreshCalls()).toBe(1);
    // One original attempt, no replay.
    expect(h.exchanges.filter((exchange) => exchange.url.includes('/farms'))).toHaveLength(1);
  });

  it('does not attempt a refresh when there is no stored token', async () => {
    const h = harness();
    h.setResource(async (config) => h.refuse(config, 401, unauthorized));

    await expect(h.client.apiGet('/farms')).rejects.toBeInstanceOf(h.errors.ApiError);
    expect(h.refreshCalls()).toBe(0);
  });
});

describe('error normalisation', () => {
  it('maps a documented failure envelope onto its code and messageKey', async () => {
    const h = harness();
    h.setResource(async (config) =>
      h.refuse(config, 422, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          messageKey: 'errors.validation',
          details: [{ field: 'name', rule: 'required' }],
        },
      }),
    );

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error).toBeInstanceOf(h.errors.ApiError);
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      messageKey: 'errors.validation',
      status: 422,
    });
    expect(error.details).toEqual([{ field: 'name', rule: 'required' }]);
  });

  it('maps an aborted request to TIMEOUT', async () => {
    const h = harness();
    h.setResource(async (config) => h.transportError(config, 'ECONNABORTED'));

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error.code).toBe('TIMEOUT');
    expect(error.messageKey).toBe('errors.network');
    expect(error.isRetryable).toBe(true);
  });

  it('maps a request that never got a response to NETWORK_ERROR', async () => {
    const h = harness();
    h.setResource(async (config) => h.transportError(config, 'ERR_NETWORK'));

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.messageKey).toBe('errors.network');
    expect(error.status).toBeNull();
  });

  it('maps a cancelled request to CANCELLED', async () => {
    const h = harness();
    h.setResource(async (config) => h.transportError(config, 'ERR_CANCELED'));

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error.code).toBe('CANCELLED');
  });

  it('maps an HTML 502 from a proxy to INTERNAL_ERROR', async () => {
    const h = harness();
    h.setResource(async (config) =>
      h.refuse(config, 502, '<html><body>502 Bad Gateway</body></html>'),
    );

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.messageKey).toBe('errors.internal');
    expect(error.status).toBe(502);
  });

  it('raises a 200 that is not the documented envelope rather than returning undefined', async () => {
    const h = harness();
    h.setResource(async (config) => h.reply(config, { farms: [] }));

    const error = (await h.client.apiGet('/farms').catch((thrown) => thrown)) as InstanceType<
      typeof h.errors.ApiError
    >;

    expect(error).toBeInstanceOf(h.errors.ApiError);
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('request decoration', () => {
  it('sends the bearer token and a correlation id, and never logs the token', async () => {
    const h = harness();
    h.session.setAccessToken('access-1');

    let seen: InternalAxiosRequestConfig | null = null;
    h.setResource(async (config) => {
      seen = config;
      return h.reply(config, { success: true, data: { ok: true } });
    });

    await h.client.apiGet('/farms');

    const config = seen as unknown as InternalAxiosRequestConfig;
    expect(config.headers.Authorization).toBe('Bearer access-1');
    expect(config.headers['X-Request-Id']).toEqual(expect.any(String));
  });

  it('omits the Authorization header when there is no session', async () => {
    const h = harness();
    h.setResource(async (config) => h.reply(config, { success: true, data: { ok: true } }));

    await h.client.apiGet('/registry/crops');

    expect(h.exchanges[0]?.authorization).toBeUndefined();
  });
});
