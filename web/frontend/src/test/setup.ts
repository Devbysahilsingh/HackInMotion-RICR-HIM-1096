import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { clearAccessToken } from '@/api/session';
import { resetTestQueryClients } from './render';
import { server } from './server';

/**
 * jsdom implements neither of these, and Recharts' ResponsiveContainer and the
 * layout code both reach for them. Stubbed rather than mocked away so the
 * components under test run their real code paths.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// `URL.createObjectURL` backs the upload preview; jsdom has no implementation.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
}

/**
 * The API is mocked at the network boundary with msw rather than by stubbing
 * the axios module. That keeps the interceptors — auth header, single-flight
 * refresh, error normalisation — inside the code under test, which is the part
 * most worth exercising.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
  resetTestQueryClients();
  // The access token lives in a module variable by design, which means it
  // survives between tests in the same file unless it is cleared here.
  clearAccessToken();
  window.localStorage.clear();
});

afterAll(async () => {
  // A request that was still resolving when the suite ended would otherwise
  // escape to the real network once msw stops listening, and jsdom logs the
  // resulting connection refusal as an error that looks like a failure but is
  // not one. One macrotask is enough for the cancelled fetches to settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.close();
});
