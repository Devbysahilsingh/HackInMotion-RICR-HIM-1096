/**
 * Query defaults and the offline cache.
 *
 * The retry policy is the web's, unchanged: a 4xx is retried zero times
 * because the same request produces the same 4xx, and retrying a 429 makes a
 * rate-limited farmer more rate-limited.
 *
 * What is mobile-only is the *persister*. `docs/offline/offline-strategy.md`
 * promises that a cold start with no signal still shows last session's
 * dashboard, weather, market and history with a ● Cached (age) label, and the
 * only way to keep a cache across a process death is to write it down. It goes
 * to AsyncStorage, which is plain text in the app sandbox — which is exactly
 * why the refresh token does not (see api/session.ts) and why logout clears it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

import { isApiError } from '@shared/client/errors';
import { STALE_TIME } from '@shared/client/queryKeys';

/** docs/offline: data 24h. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

export const PERSIST_KEY = 'him1096.queryCache';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.interactive,
        // Keep data long after it goes stale so an offline screen still
        // renders something, labelled (ADR-008).
        gcTime: CACHE_MAX_AGE_MS,
        retry: (failureCount, error) => {
          if (isApiError(error) && !error.isRetryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        /**
         * `refetchOnWindowFocus` is a browser idea; on Android the equivalent
         * is app foregrounding, wired up in `hooks/useAppStateRefetch.ts` so it
         * can be switched off while the camera is open. `refetchOnReconnect`
         * works as-is — NetInfo drives React Query's online manager.
         */
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        // A mutation that failed did something, or nearly did. Replaying it
        // automatically could double-write an irrigation log.
        retry: false,
      },
    },
  });
}

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSIST_KEY,
  throttleTime: 2_000,
});

/**
 * Erases the persisted cache from disk, now.
 *
 * `queryClient.clear()` empties the *in-memory* cache and the persister
 * notices — but it writes on a 2s throttle, so between a logout and that write
 * the previous farmer's dehydrated dashboard, farms, prices and health history
 * are still sitting in AsyncStorage in plain text. Killing the app inside that
 * window (or handing the phone over, which is the threat model this cache is
 * cleared for at all) leaves them there to be rehydrated by whoever logs in
 * next.
 *
 * A throttled write is the wrong instrument for a privacy boundary, so logout
 * deletes the key outright and does not depend on the throttle firing.
 * Swallowed on failure for the same reason `clearRefreshToken` is: logout must
 * always end signed out, and a storage error is not a reason to strand a farmer
 * inside an account.
 */
export async function clearPersistedCache(): Promise<void> {
  try {
    await queryPersister.removeClient();
  } catch {
    // Already gone, or the store is unwritable. Either way there is nothing
    // further this device can do about it.
  }
}

/**
 * Which queries are allowed to survive a restart.
 *
 * Only successful reads. A failed query would rehydrate as a permanent error
 * screen on a device that is now perfectly online, and a pending one would
 * rehydrate as a spinner with nothing behind it.
 */
export const shouldPersistQuery = (status: string): boolean => status === 'success';
