/**
 * Refetch on foreground — React Native's answer to `refetchOnWindowFocus`.
 *
 * `api/queryClient.ts` switches the browser option off and points here: there
 * is no window to focus on Android, and the equivalent moment is the app coming
 * back from the background. A farmer who put the phone in a pocket for twenty
 * minutes and pulled it out again should not be reading yesterday's advice with
 * no indication that it moved.
 *
 * Two deliberate restraints:
 *
 * 1. **Suppressible.** The camera flow leaves and re-enters `active` every time
 *    a permission dialog or the gallery picker opens, and a refetch storm
 *    behind a live preview competes for the same scarce radio the upload is
 *    about to need. Any screen can call `useSuppressAppStateRefetch()` and the
 *    global listener stands down for as long as that screen is mounted.
 * 2. **The registry is exempt.** Its content changes only when the seed script
 *    runs (`STALE_TIME.registry` is seven days) and it is the one cache
 *    docs/mobile/offline-strategy.md promises will still be there in a field
 *    with no signal. Invalidating it on every foreground would spend a request
 *    on data that cannot have changed.
 *
 * Nothing is refetched while offline: React Query would pause the fetches
 * anyway, and marking every query stale for a device that cannot reach the
 * server only strips the cache of its "fresh" status for no gain.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { onlineManager, useQueryClient } from '@tanstack/react-query';

/**
 * Module-level rather than context, because the suppressing screen and the
 * listening hook are mounted at opposite ends of the tree — a provider between
 * them would exist only to carry this one counter.
 */
let suppressions = 0;

/** Suppresses foreground refetching while the calling screen is mounted. */
export function useSuppressAppStateRefetch(): void {
  useEffect(() => {
    suppressions += 1;
    return () => {
      suppressions -= 1;
    };
  }, []);
}

export const isAppStateRefetchSuppressed = (): boolean => suppressions > 0;

export interface AppStateRefetchOptions {
  /** Off switch for callers that own the decision themselves. */
  enabled?: boolean;
}

export function useAppStateRefetch({ enabled = true }: AppStateRefetchOptions = {}): void {
  const queryClient = useQueryClient();
  const previous = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // Only the background → active edge. Android also emits `inactive`
      // during a rotation or a notification shade pull, and treating every
      // `active` as a return would refetch several times for one foregrounding.
      const returned = previous.current !== 'active' && next === 'active';
      previous.current = next;

      if (!returned || !enabled || isAppStateRefetchSuppressed()) return;
      if (!onlineManager.isOnline()) return;

      void queryClient.invalidateQueries({
        refetchType: 'active',
        predicate: (query) => query.queryKey[0] !== 'registry',
      });
    });

    return () => subscription.remove();
  }, [enabled, queryClient]);
}
