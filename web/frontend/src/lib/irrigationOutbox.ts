/**
 * Web binding for the shared irrigation outbox.
 *
 * The queue logic lives in `@shared/client/irrigationOutbox` so the web and
 * Android clients cannot drift apart on the one thing that must not drift:
 * when a queued watering is dropped versus retried. This file supplies only
 * the two things that are genuinely platform-specific — `localStorage` and the
 * browser's online/offline events.
 */
import { useCallback, useEffect, useState } from 'react';

import { cropsApi } from '@/api/endpoints';
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

/**
 * `localStorage` throws in private-mode Safari and when a quota is exceeded,
 * and it is absent during SSR. A queue that cannot persist must degrade to "no
 * queue" rather than take the irrigation form down with it.
 */
const storage: OutboxStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* full or blocked — the write is lost, which the UI already reports as pending */
    }
  },
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
 * Pending waterings for one crop, plus a flush that runs when the browser says
 * the connection is back.
 *
 * `navigator.onLine` is only trustworthy in the negative direction — it can
 * report true on a captive portal — so it is used to *trigger* a flush, never
 * to decide whether a write will succeed. The attempt itself is the test.
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
    // Try once on mount too: the tab may have been opened after the connection
    // came back, in which case no `online` event will ever fire.
    if (navigator.onLine) void flush();

    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropId]);

  return { pending, refresh, flush };
}
