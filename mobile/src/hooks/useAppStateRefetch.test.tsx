/**
 * Foreground refetching.
 *
 * Three properties are worth holding down, and each of them is a bug that only
 * shows up on a device: refetching on the background → active edge and not on
 * every `inactive` blip, standing down while a screen has suppressed it (the
 * camera, whose permission and gallery dialogs each produce an `active`
 * transition), and leaving the seven-day registry cache alone.
 */
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

import { useAppStateRefetch, useSuppressAppStateRefetch } from './useAppStateRefetch';

type Handler = (status: AppStateStatus) => void;

let handler: Handler | null = null;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  handler = null;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    handler = listener as Handler;
    return { remove: jest.fn() } as never;
  });

  onlineManager.setOnline(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

const foreground = () => {
  handler?.('background');
  handler?.('active');
};

it('invalidates active queries when the app returns to the foreground', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  renderHook(() => useAppStateRefetch(), { wrapper });

  foreground();

  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ refetchType: 'active' }));
});

it('leaves the registry cache alone', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  renderHook(() => useAppStateRefetch(), { wrapper });

  foreground();

  const filters = invalidate.mock.calls[0]?.[0] as
    { predicate?: (query: { queryKey: readonly unknown[] }) => boolean } | undefined;

  expect(filters?.predicate?.({ queryKey: ['registry', 'list'] })).toBe(false);
  expect(filters?.predicate?.({ queryKey: ['dashboard'] })).toBe(true);
});

it('refetches once per foregrounding, not once per active event', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  renderHook(() => useAppStateRefetch(), { wrapper });

  handler?.('background');
  handler?.('active');
  // Android re-announces `active` after a dialog closes. The edge has already
  // been consumed, so a second announcement must not spend another round-trip.
  handler?.('active');

  expect(invalidate).toHaveBeenCalledTimes(1);
});

it('stands down while a screen suppresses it', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

  const suppressor = renderHook(() => useSuppressAppStateRefetch(), { wrapper });
  renderHook(() => useAppStateRefetch(), { wrapper });

  foreground();
  expect(invalidate).not.toHaveBeenCalled();

  suppressor.unmount();
  foreground();
  expect(invalidate).toHaveBeenCalledTimes(1);
});

it('does not refetch into a dead radio', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  onlineManager.setOnline(false);

  renderHook(() => useAppStateRefetch(), { wrapper });
  foreground();

  expect(invalidate).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
});

it('can be switched off by its caller', () => {
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  renderHook(() => useAppStateRefetch({ enabled: false }), { wrapper });

  foreground();

  expect(invalidate).not.toHaveBeenCalled();
});
