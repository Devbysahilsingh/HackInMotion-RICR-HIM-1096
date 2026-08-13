import { QueryClient } from '@tanstack/react-query';

import { isApiError } from './errors';
import { STALE_TIME } from './queryKeys';

/**
 * Query defaults.
 *
 * The retry policy is the part worth reading: a 4xx is retried zero times
 * because the same request will produce the same 4xx, and retrying a 429 would
 * make a rate-limited farmer more rate-limited. Only genuinely transient
 * failures — network drops, 5xx — get a second and third go.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.interactive,
        // Cache-first is the product's resilience story (ADR-008): keep data
        // around long after it goes stale so an offline screen still renders
        // something, labelled.
        gcTime: 24 * 60 * 60_000,
        retry: (failureCount, error) => {
          if (isApiError(error) && !error.isRetryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // Refetching on focus is right for a dashboard a farmer returns to
        // through the day; `staleTime` keeps it from being chatty.
        refetchOnWindowFocus: true,
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
