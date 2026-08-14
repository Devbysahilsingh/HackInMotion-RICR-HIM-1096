/**
 * Android binding for the shared irrigation outbox.
 *
 * Same queue logic as the web (`@shared/client/irrigationOutbox`) — only the
 * storage and the connectivity source differ. This is the client where the
 * feature actually earns its keep: the phone is what a farmer has in the field,
 * and the field is where the signal is not.
 *
 * Storage is AsyncStorage, which is plain text in the app sandbox. That is
 * acceptable here and not for the refresh token (see `api/session.ts`): a
 * queued watering is a date and a millimetre figure the farmer already knows,
 * carrying no credential and granting no access.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { isApiError } from '@shared/client/errors';
import {
  enqueueIrrigation,
  flushOutbox,
  newRequestId,
  queuedForCrop,
  type FlushResult,
  type OutboxStorage,
  type QueuedIrrigation,
} from '@shared/client/irrigationOutbox';

import { cropsApi } from './endpoints';

const storage: OutboxStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

/** A 4xx that is not a 429 will never become a 2xx; anything else may. */
const isPermanentFailure = (error: unknown): boolean => isApiError(error) && !error.isRetryable;

export const newIrrigationRequestId = newRequestId;

export async function queueIrrigation(entry: {
  clientRequestId: string;
  cropId: string;
  date: string;
  amountMm?: number;
}): Promise<QueuedIrrigation> {
  return enqueueIrrigation(storage, entry);
}

export async function flushIrrigationOutbox(): Promise<FlushResult> {
  return flushOutbox({
    storage,
    send: (item) =>
      cropsApi.logIrrigation(item.cropId, {
        date: item.date,
        ...(item.amountMm !== undefined ? { amountMm: item.amountMm } : {}),
        clientRequestId: item.clientRequestId,
      }),
    isPermanentFailure,
  });
}

/**
 * Pending waterings for one crop, flushed when the radio comes back.
 *
 * Subscribes to NetInfo directly rather than to React Query's `onlineManager`:
 * the manager is already driven by NetInfo in `useOnlineManager`, and reading
 * the same source is simpler than adding a second listener to a listener.
 * `isInternetReachable` is preferred for the reason given there — a phone on a
 * Wi-Fi access point with no upstream is "connected" and useless.
 */
export function useIrrigationOutbox(cropId: string, onSynced?: (result: FlushResult) => void) {
  const [pending, setPending] = useState<QueuedIrrigation[]>([]);

  const refresh = useCallback(async () => {
    setPending(await queuedForCrop(storage, cropId));
  }, [cropId]);

  const flush = useCallback(async () => {
    const result = await flushIrrigationOutbox();
    await refresh();
    if (result.synced > 0) onSynced?.(result);
    return result;
  }, [refresh, onSynced]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let wasOffline = false;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isInternetReachable ?? state.isConnected ?? false;

      // Flush on the transition into connectivity, not on every event: NetInfo
      // emits repeatedly on a flapping radio, and each flush is a real POST
      // against a 10/day rate limit.
      if (online && wasOffline) void flush();
      wasOffline = !online;
    });

    void NetInfo.fetch().then((state) => {
      if (state.isInternetReachable ?? state.isConnected ?? false) void flush();
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropId]);

  return { pending, refresh, flush };
}
