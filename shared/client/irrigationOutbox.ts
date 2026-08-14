/**
 * The offline outbox for irrigation logs.
 *
 * docs/offline/offline-strategy.md promises reads survive a dead connection.
 * This is the other half: the one *write* a farmer makes standing in a field
 * with no signal. Scope is deliberately narrow — irrigation logs only. Photo
 * uploads are multi-megabyte binaries and crop/farm creation happens at setup
 * on wifi, so neither belongs in a queue that has to survive a process death.
 *
 * **Why this is safe to replay.** Every queued item carries a
 * `clientRequestId`, and the server enforces uniqueness on
 * `(userId, clientRequestId)` with a partial index. A flush that never sees its
 * response can therefore re-send without double-watering the ledger: the
 * duplicate collapses server-side and comes back `replayed: true`. Two genuine
 * waterings on one day carry two different ids and both persist — the id
 * identifies a submission, never a day.
 *
 * **Storage is injected, not imported.** The web has `localStorage` and mobile
 * has `AsyncStorage`, one sync and one async. Both are adapted to the same
 * promise-returning port here so the queue logic exists once rather than being
 * written twice and drifting.
 *
 * Nothing here is a second source of truth. The outbox holds only writes that
 * have *not* landed; once the server acknowledges one it is dropped, and the
 * server's ledger is the record from then on.
 */

/** A watering the farmer recorded but the server has not acknowledged. */
export interface QueuedIrrigation {
  /** Idempotency key — the whole reason a replay is safe. */
  clientRequestId: string;
  cropId: string;
  /** ISO instant, exactly as the online path would have sent it. */
  date: string;
  amountMm?: number;
  /** When it was queued, so the UI can age-label it honestly. */
  queuedAt: string;
  /** Flush attempts so far; bounds a poison item (see MAX_ATTEMPTS). */
  attempts: number;
}

/** Minimal storage port. `localStorage` and `AsyncStorage` both satisfy it. */
export interface OutboxStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/**
 * Storage key, in the same namespace as the sibling `him1096.queryCache`
 * (mobile/src/api/queryClient.ts).
 *
 * `gitleaks:allow` — gitleaks' `generic-api-key` rule fires on the shape
 * `*_KEY = '<string with entropy>'`, which this is, and a credential, which it
 * is not: it is the literal name a queued watering is filed under in
 * localStorage/AsyncStorage, readable in any browser devtools panel. The
 * annotation is scoped to this one line rather than allowlisting the file or a
 * value pattern, because .gitleaks.toml is deliberately minimal and a broad
 * rule here would hide a real finding later.
 */
export const OUTBOX_KEY = 'him1096.irrigationOutbox'; // gitleaks:allow

/**
 * A queued write is dropped after this many failed flushes.
 *
 * Without a bound, one item the server will never accept — a crop deleted from
 * another device, say — retries on every reconnect forever. Five is generous
 * enough to ride out a bad week of connectivity and small enough that the queue
 * cannot grow unboundedly.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Hard cap on queue length. A farmer logging waterings offline for a season
 * should not be able to fill device storage; the oldest is dropped first
 * because the newest watering is the one the verdict depends on.
 */
export const MAX_QUEUED = 50;

/**
 * A v4 UUID, from the platform CSPRNG where there is one.
 *
 * The fallback matters: `crypto.randomUUID` needs a secure context, and React
 * Native's Hermes has historically shipped without it. A collision here would
 * silently *discard* a real watering (two ids equal ⇒ the second reads as a
 * replay), so the fallback still draws from `getRandomValues` and only reaches
 * `Math.random` if the runtime offers no CSPRNG at all.
 */
export function newRequestId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;

  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 version and variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reads the queue, tolerating anything that is not a queue we wrote. */
export async function readOutbox(storage: OutboxStorage): Promise<QueuedIrrigation[]> {
  try {
    const raw = await storage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueued);
  } catch {
    // Corrupt or unreadable storage must not take the screen down. An empty
    // queue is the honest degraded answer: we cannot prove anything is pending.
    return [];
  }
}

function isQueued(value: unknown): value is QueuedIrrigation {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<QueuedIrrigation>;
  return (
    typeof item.clientRequestId === 'string' &&
    typeof item.cropId === 'string' &&
    typeof item.date === 'string' &&
    typeof item.queuedAt === 'string' &&
    typeof item.attempts === 'number' &&
    (item.amountMm === undefined || typeof item.amountMm === 'number')
  );
}

async function writeOutbox(storage: OutboxStorage, items: QueuedIrrigation[]): Promise<void> {
  await storage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
}

/**
 * Queues a watering. Returns the stored item so the caller can show it
 * immediately — the farmer's tap must leave a visible trace even offline.
 */
export async function enqueueIrrigation(
  storage: OutboxStorage,
  entry: Omit<QueuedIrrigation, 'queuedAt' | 'attempts'>,
): Promise<QueuedIrrigation> {
  const items = await readOutbox(storage);
  const queued: QueuedIrrigation = { ...entry, queuedAt: new Date().toISOString(), attempts: 0 };

  // Guard against a double-tap enqueueing the same id twice.
  const deduped = items.filter((item) => item.clientRequestId !== queued.clientRequestId);
  await writeOutbox(storage, [...deduped, queued]);
  return queued;
}

export async function removeQueued(storage: OutboxStorage, clientRequestId: string): Promise<void> {
  const items = await readOutbox(storage);
  await writeOutbox(
    storage,
    items.filter((item) => item.clientRequestId !== clientRequestId),
  );
}

/** Queued items for one crop, oldest first — what the ledger renders as pending. */
export async function queuedForCrop(
  storage: OutboxStorage,
  cropId: string,
): Promise<QueuedIrrigation[]> {
  return (await readOutbox(storage)).filter((item) => item.cropId === cropId);
}

export interface FlushResult {
  /** Acknowledged by the server (created or collapsed as a replay). */
  synced: number;
  /** Still queued — no connection, rate limited, or a server fault. */
  kept: number;
  /** Dropped: the server refused them permanently, or they exhausted attempts. */
  dropped: number;
}

export interface FlushDeps {
  storage: OutboxStorage;
  /** Performs the real POST. Rejects on transport failure. */
  send(item: QueuedIrrigation): Promise<unknown>;
  /**
   * Whether a rejection means "this will never succeed".
   *
   * Injected because each client already owns its error taxonomy — the web and
   * mobile API layers both expose `isApiError`/`isRetryable`, and duplicating
   * that judgement here would create the second source of truth this module
   * exists to avoid.
   */
  isPermanentFailure(error: unknown): boolean;
}

/**
 * Sends every queued item once, oldest first.
 *
 * Serial, not parallel, and that is deliberate: the write is rate limited
 * (10/day per user) and a burst of concurrent posts from a phone that just
 * regained signal is the fastest way to spend that budget on 429s. Serial also
 * keeps ledger order stable.
 *
 * Never throws. A flush runs on reconnect, in the background, where an
 * exception would surface as an unhandled rejection rather than something a
 * farmer could act on.
 */
export async function flushOutbox(deps: FlushDeps): Promise<FlushResult> {
  const { storage, send, isPermanentFailure } = deps;
  const items = await readOutbox(storage);
  if (items.length === 0) return { synced: 0, kept: 0, dropped: 0 };

  const remaining: QueuedIrrigation[] = [];
  let synced = 0;
  let dropped = 0;

  for (const item of items) {
    try {
      await send(item);
      synced += 1;
    } catch (error) {
      const attempts = item.attempts + 1;

      // A 4xx that is not a rate limit will not become a 2xx on retry: the crop
      // is gone, or the payload is invalid. Keeping it would retry forever.
      if (isPermanentFailure(error) || attempts >= MAX_ATTEMPTS) {
        dropped += 1;
        continue;
      }

      remaining.push({ ...item, attempts });
    }
  }

  await writeOutbox(storage, remaining);
  return { synced, kept: remaining.length, dropped };
}
