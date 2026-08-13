/**
 * Warms the crop registry into the persisted cache, once per signed-in session.
 *
 * docs/mobile/offline-strategy.md commits to this by name: "Registry+symptom KB
 * prefetched post-login ⇒ SymptomChecklist genuinely works offline (in-field
 * value)". The registry is the only knowledge base this app can honestly hold
 * on the device — it is public, it is small (a single-digit crop roster), and
 * `STALE_TIME.registry` is seven days because its content changes only when the
 * seed script runs. Everything else a screen needs is per-account and moves.
 *
 * Two levels are fetched. The list backs `useCropNames` and the crop pickers;
 * the per-crop documents carry `diseases[].names`, `symptomTags` and `kcStages`,
 * which is what a symptom screen reads. Fetching them at login rather than on
 * first use is the whole point: the farmer is standing in a field when they
 * need it, and the last place they had signal was the house.
 *
 * The per-crop pass is sequential on purpose. It is background work competing
 * with the dashboard the farmer is actually looking at, on a connection that is
 * assumed to be poor.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { RegistrySummary } from '@shared/types/api';

import type { Paged } from '../api/client';
import { registryApi } from '../api/endpoints';
import { useAuth } from '../store/AuthContext';
import { useNetworkStatus } from './useOnlineManager';

type RegistryList = Paged<{ crops: RegistrySummary[] }>;

export function usePrefetchRegistry(): void {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { online, known } = useNetworkStatus();

  // Once per session, not once per mount: this hook lives on a component that
  // survives navigation, but a remount must not re-run a dozen requests.
  const started = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') {
      started.current = false;
      return;
    }
    // Offline, this would only queue paused fetches. The reconnect listener in
    // `useOnlineManager` re-runs this effect when the signal returns.
    if (!known || !online || started.current) return;

    started.current = true;
    let cancelled = false;

    void (async () => {
      // `prefetchQuery` resolves rather than rejects on failure, so the cache
      // is what reports whether it worked.
      await queryClient.prefetchQuery({
        queryKey: queryKeys.registry.list(),
        queryFn: registryApi.list,
        staleTime: STALE_TIME.registry,
      });

      const list = queryClient.getQueryData<RegistryList>(queryKeys.registry.list());
      if (!list) {
        // Nothing landed. Let the next reconnect try again rather than
        // marking the session warmed on a failure.
        started.current = false;
        return;
      }

      for (const crop of list.data.crops) {
        if (cancelled) return;
        await queryClient.prefetchQuery({
          queryKey: queryKeys.registry.crop(crop.cropCode),
          queryFn: () => registryApi.get(crop.cropCode),
          staleTime: STALE_TIME.registry,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, online, known, queryClient]);
}
