/**
 * Network state → React Query, and a hook for screens that need to know.
 *
 * React Query's default online detection is `navigator.onLine`, which React
 * Native pins to `true` forever. Left alone, a query on a dead radio retries
 * its full budget into nothing and then reports a hard error, instead of
 * pausing and resuming the moment the signal comes back (RES-12).
 *
 * `isInternetReachable` is preferred over `isConnected` where the platform
 * supplies it: a phone attached to a Wi-Fi access point with no upstream is
 * "connected" and completely useless, which is a common shape of rural
 * connectivity rather than an exotic edge case.
 */
import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

const isOnline = (state: NetInfoState): boolean =>
  state.isInternetReachable ?? state.isConnected ?? false;

export function useOnlineManager(): void {
  useEffect(
    () =>
      onlineManager.setEventListener((setOnline) =>
        NetInfo.addEventListener((state) => {
          setOnline(isOnline(state));
        }),
      ),
    [],
  );
}

export interface NetworkStatus {
  online: boolean;
  /** Null until the first NetInfo event lands — not the same as offline. */
  known: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({ online: true, known: false });

  useEffect(() => {
    let cancelled = false;

    void NetInfo.fetch().then((state) => {
      if (!cancelled) setStatus({ online: isOnline(state), known: true });
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!cancelled) setStatus({ online: isOnline(state), known: true });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}
