/**
 * The login-time registry warm-up.
 *
 * The promise in docs/mobile/offline-strategy.md is specific — the registry is
 * in the persisted cache *before* the farmer walks into a field — so the tests
 * are about when it runs rather than about the requests themselves: once per
 * session, never while signed out, never into a dead radio, and at the seven-day
 * staleness the shared key registry declares.
 */
import type { ReactNode } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { RegistrySummary } from '@shared/types/api';

import { registryApi } from '../api/endpoints';
import type { AuthStatus } from '../store/AuthContext';
import { usePrefetchRegistry } from './usePrefetchRegistry';

jest.mock('../api/endpoints', () => ({
  registryApi: { list: jest.fn(), get: jest.fn() },
}));

let mockAuthStatus: AuthStatus = 'authenticated';
jest.mock('../store/AuthContext', () => ({
  useAuth: () => ({ status: mockAuthStatus }),
}));

const state = (partial: Partial<NetInfoState>): NetInfoState => partial as NetInfoState;

const crops: RegistrySummary[] = [
  {
    cropCode: 'TOMATO',
    names: { en: 'Tomato', hi: 'टमाटर' },
    supportLevel: 'SPECIALIZED',
    seasons: ['KHARIF'],
    mlSupported: true,
  },
  {
    cropCode: 'RICE',
    names: { en: 'Rice', hi: 'धान' },
    supportLevel: 'SPECIALIZED',
    seasons: ['KHARIF'],
    mlSupported: true,
  },
];

let queryClient: QueryClient;
/** The callback `useNetworkStatus` registers, so a test can stage a reconnect. */
let netListener: ((state: NetInfoState) => void) | null = null;

const goOffline = () =>
  act(() => netListener?.(state({ isConnected: true, isInternetReachable: false })));
const goOnline = () =>
  act(() => netListener?.(state({ isConnected: true, isInternetReachable: true })));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthStatus = 'authenticated';
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  netListener = null;
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
    netListener = listener as (state: NetInfoState) => void;
    return jest.fn();
  });
  jest
    .mocked(NetInfo.fetch)
    .mockResolvedValue(state({ isConnected: true, isInternetReachable: true }) as never);

  jest.mocked(registryApi.list).mockResolvedValue({ data: { crops }, meta: {} });
  jest.mocked(registryApi.get).mockImplementation(async (cropCode: string) => ({
    crop: { cropCode, names: { en: cropCode, hi: cropCode }, supportLevel: 'SPECIALIZED' },
  }));
});

afterEach(() => {
  queryClient.clear();
});

it('caches the roster and every crop document, once', async () => {
  const { rerender } = renderHook(() => usePrefetchRegistry(), { wrapper });

  await waitFor(() => expect(registryApi.get).toHaveBeenCalledTimes(crops.length));

  expect(registryApi.list).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(queryKeys.registry.list())).toEqual({
    data: { crops },
    meta: {},
  });
  expect(queryClient.getQueryData(queryKeys.registry.crop('TOMATO'))).toBeDefined();

  // A remount must not replay a dozen requests on a rural connection.
  rerender(undefined);
  await waitFor(() => expect(registryApi.list).toHaveBeenCalledTimes(1));
});

it('holds the roster at the registry staleness, not the interactive default', async () => {
  renderHook(() => usePrefetchRegistry(), { wrapper });

  await waitFor(() => expect(registryApi.list).toHaveBeenCalledTimes(1));

  // `staleTime` is an observer option, so it is not on the cache entry's
  // declared type — but it is what `prefetchQuery` recorded, and it is the
  // whole point of the prefetch.
  const cached = queryClient.getQueryCache().find({ queryKey: queryKeys.registry.list() });
  const options = cached?.options as { staleTime?: number } | undefined;
  expect(options?.staleTime).toBe(STALE_TIME.registry);
});

it('does not run while signed out', async () => {
  mockAuthStatus = 'anonymous';

  renderHook(() => usePrefetchRegistry(), { wrapper });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(registryApi.list).not.toHaveBeenCalled();
});

it('does not run while offline', async () => {
  jest
    .mocked(NetInfo.fetch)
    .mockResolvedValue(state({ isConnected: true, isInternetReachable: false }) as never);

  renderHook(() => usePrefetchRegistry(), { wrapper });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(registryApi.list).not.toHaveBeenCalled();
});

it('retries on the next reconnect when the roster never landed', async () => {
  jest.mocked(registryApi.list).mockRejectedValue(new Error('offline'));

  renderHook(() => usePrefetchRegistry(), { wrapper });

  await waitFor(() => expect(registryApi.list).toHaveBeenCalledTimes(1));
  // The per-crop pass must not run against a roster that never arrived.
  expect(registryApi.get).not.toHaveBeenCalled();

  jest.mocked(registryApi.list).mockResolvedValue({ data: { crops }, meta: {} });
  goOffline();
  goOnline();

  await waitFor(() => expect(registryApi.get).toHaveBeenCalledTimes(crops.length));
});
