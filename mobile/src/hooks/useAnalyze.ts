/**
 * The upload state machine behind the hero flow.
 *
 * `POST /crop-health/analyze` is the one request in this app that is slow,
 * expensive, rate-limited, and holds something the farmer cannot easily make
 * again — a photograph of a leaf they are standing next to right now. Every
 * decision here follows from that:
 *
 * - **The screen owns the bytes, not the request.** `prepareForUpload` runs
 *   once and its output is kept in a ref, so a retry after a dropped signal
 *   sends the *same* compressed file rather than sending the farmer back to
 *   the camera (docs/mobile/camera-and-upload.md RES-10).
 * - **The stages are observed, not timed.** `compressing` ends when the
 *   manipulator resolves; `uploading` ends when axios reports every byte
 *   delivered; `analyzing` is the window while the conductor's ml → gemini →
 *   rules chain runs server-side. Nothing advances on a timer, because a
 *   progress bar that moves without progress is a fabricated status
 *   (CLAUDE.md rule 7).
 * - **Failures are classified, not merged.** A dropped connection and a photo
 *   of a wall are different problems with different remedies, and the screen
 *   cannot offer the right one from a single error string. `classifyAnalyzeFailure`
 *   is where that judgement lives, and it is a pure function so it can be
 *   tested against the exact envelopes `middleware/uploadImage.js` emits.
 *
 * Deliberately free of React Query: this is a one-shot imperative sequence with
 * its own cancellation, and a mutation wrapper would add a provider dependency
 * to something the test suite should be able to drive on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiError, type ValidationDetail } from '@shared/client/errors';
import type { HealthLog } from '@shared/types/api';

import { healthApi } from '../api/endpoints';
import { prepareForUpload } from '../services/image';

// ── The machine ─────────────────────────────────────────────────────────────

export const ANALYZE_STAGES = [
  'idle',
  'compressing',
  'uploading',
  'analyzing',
  'done',
  'failed',
] as const;

export type AnalyzeStage = (typeof ANALYZE_STAGES)[number];

/**
 * Stage → the sentence the farmer reads.
 *
 * `done` keeps a label because the screen is still doing something real when
 * it lands — writing the result into the cache and swapping screens — and a
 * blank panel in that gap reads as a hang.
 */
export const STAGE_LABEL_KEY: Record<AnalyzeStage, string | null> = {
  idle: null,
  compressing: 'mobile:upload.compressing',
  uploading: 'mobile:upload.uploading',
  analyzing: 'mobile:upload.analyzing',
  done: 'mobile:upload.preparing',
  failed: null,
};

// ── Failure classification ──────────────────────────────────────────────────

export type AnalyzeFailureKind =
  /** The farmer stopped it. Not an error; no message is shown. */
  | 'cancelled'
  /** The bytes never arrived — signal dropped, request timed out. */
  | 'network'
  /** 3/minute and 10/day per user. Waiting is the only remedy. */
  | 'rateLimited'
  /** The server read the image and refused it. A different photo is needed. */
  | 'photoRejected'
  /** The photo could not be decoded on this handset. */
  | 'prepareFailed'
  /** Ours, and transient: a 5xx, or storage that was briefly unavailable. */
  | 'server'
  /** A 4xx that is neither of the above — a deleted crop, a bad request. */
  | 'rejected';

export interface AnalyzeFailure {
  kind: AnalyzeFailureKind;
  /** Always resolvable through `i18n/messageKey.ts`. */
  messageKey: string;
  /** The server's `details[].rule`, when it named one. */
  rule: string | null;
  status: number | null;
  /** The same compressed file may be sent again. */
  canRetrySameImage: boolean;
  /** The photograph itself is the problem — ask for a new one. */
  needsNewPhoto: boolean;
  /**
   * How long the farmer has to wait, from the 429's `Retry-After` header.
   * Null for every other kind of failure, and null for a 429 whose header was
   * missing — in which case the screen says "wait a little" rather than naming
   * a duration nobody measured (rule 7).
   */
  retryAfterSeconds: number | null;
}

/**
 * `UPLOAD_ERROR` reason → message key, transcribed from
 * `backend/src/middleware/uploadImage.js`.
 *
 * The server already sends the right `messageKey`, so this map is a fallback
 * for a truncated envelope rather than the primary path. What it is really
 * for is the set membership below: the *reason* is what decides whether a
 * retry could ever succeed, and that decision cannot be read off the prose.
 */
export const UPLOAD_RULE_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  NO_FILE: 'errors.uploadNoFile',
  TOO_LARGE: 'errors.uploadTooLarge',
  UNSUPPORTED_FORMAT: 'errors.uploadUnsupportedFormat',
  DIMENSIONS_TOO_LARGE: 'errors.uploadDimensionsTooLarge',
  ANIMATED: 'errors.uploadAnimated',
  UNREADABLE: 'errors.uploadUnreadable',
  STORAGE_UNAVAILABLE: 'errors.uploadStorageUnavailable',
  NOT_AN_IMAGE: 'errors.uploadNotAnImage',
};

/**
 * Reasons that are a verdict on the *content* of the photograph.
 *
 * `NO_FILE` and `STORAGE_UNAVAILABLE` are deliberately absent: neither says
 * anything about the image, and both can succeed on a second attempt with the
 * identical bytes. Asking a farmer to walk back to the field and re-shoot for
 * a transfer that was merely truncated would be the app's mistake charged to
 * them.
 */
const PHOTO_CONTENT_RULES = new Set([
  'TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'DIMENSIONS_TOO_LARGE',
  'ANIMATED',
  'UNREADABLE',
  'NOT_AN_IMAGE',
]);

const CANCELLED_FAILURE: AnalyzeFailure = {
  kind: 'cancelled',
  messageKey: 'errors.network',
  rule: null,
  status: null,
  canRetrySameImage: true,
  needsNewPhoto: false,
  retryAfterSeconds: null,
};

const PREPARE_FAILURE: AnalyzeFailure = {
  kind: 'prepareFailed',
  messageKey: 'errors.uploadUnreadable',
  rule: null,
  status: null,
  canRetrySameImage: false,
  needsNewPhoto: true,
  retryAfterSeconds: null,
};

/** The `rule` an `UPLOAD_ERROR` names, or null for any other failure. */
function uploadRule(details: readonly unknown[]): string | null {
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const { rule } = detail as ValidationDetail;
    if (typeof rule === 'string' && rule.length > 0) return rule;
  }
  return null;
}

export function classifyAnalyzeFailure(error: unknown): AnalyzeFailure {
  if (!isApiError(error)) {
    return {
      kind: 'server',
      messageKey: 'errors.internal',
      rule: null,
      status: null,
      canRetrySameImage: true,
      needsNewPhoto: false,
      retryAfterSeconds: null,
    };
  }

  if (error.code === 'CANCELLED') return CANCELLED_FAILURE;

  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
    return {
      kind: 'network',
      messageKey: error.messageKey,
      rule: null,
      status: error.status,
      canRetrySameImage: true,
      needsNewPhoto: false,
      retryAfterSeconds: null,
    };
  }

  /*
   * 429 carries `Retry-After` as a *header*, which the axios interceptor now
   * parses onto `ApiError.retryAfterSeconds`. It is passed through unchanged
   * and stays null when the header was absent: the screen names a wait only
   * when the server named one, because inventing "wait 40 seconds" from a
   * number we do not have is exactly the fabricated metric rule 7 forbids.
   * Nothing retries on its own either — an automatic retry against a burst
   * limit only deepens the block.
   */
  if (error.status === 429) {
    return {
      kind: 'rateLimited',
      messageKey: error.messageKey,
      rule: null,
      status: 429,
      canRetrySameImage: true,
      needsNewPhoto: false,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (error.code === 'UPLOAD_ERROR') {
    const rule = uploadRule(error.details);
    const photoIsTheProblem = rule !== null && PHOTO_CONTENT_RULES.has(rule);

    return {
      kind: photoIsTheProblem ? 'photoRejected' : 'server',
      messageKey:
        error.messageKey || (rule ? UPLOAD_RULE_MESSAGE_KEYS[rule] : null) || 'errors.internal',
      rule,
      status: error.status,
      canRetrySameImage: !photoIsTheProblem,
      needsNewPhoto: photoIsTheProblem,
      retryAfterSeconds: null,
    };
  }

  if (error.status !== null && error.status >= 500) {
    return {
      kind: 'server',
      messageKey: error.messageKey,
      rule: null,
      status: error.status,
      canRetrySameImage: true,
      needsNewPhoto: false,
      retryAfterSeconds: null,
    };
  }

  return {
    kind: 'rejected',
    messageKey: error.messageKey,
    rule: null,
    status: error.status,
    canRetrySameImage: false,
    needsNewPhoto: false,
    retryAfterSeconds: null,
  };
}

// ── The hook ────────────────────────────────────────────────────────────────

export interface AnalyzeState {
  stage: AnalyzeStage;
  /** 0–1. Determinate, and only meaningful while `stage === 'uploading'`. */
  progress: number;
  log: HealthLog | null;
  failure: AnalyzeFailure | null;
  /** The compressed file actually sent. Retained so a retry reuses it. */
  preparedUri: string | null;
}

export interface UseAnalyzeInput {
  cropId: string;
  /** The camera or gallery URI, before compression. */
  imageUri: string;
  description?: string;
  shareToCommunity?: boolean;
  /** Off in tests, so `start()` can be driven a step at a time. */
  autoStart?: boolean;
}

export interface UseAnalyzeResult {
  state: AnalyzeState;
  /** The sentence for the current stage, or null when there is nothing to say. */
  labelKey: string | null;
  start: () => void;
  /** Re-sends the same compressed bytes; re-compresses only if we never got any. */
  retry: () => void;
  cancel: () => void;
}

const INITIAL_STATE: AnalyzeState = {
  stage: 'idle',
  progress: 0,
  log: null,
  failure: null,
  preparedUri: null,
};

export function useAnalyze({
  cropId,
  imageUri,
  description,
  shareToCommunity,
  autoStart = true,
}: UseAnalyzeInput): UseAnalyzeResult {
  const [state, setState] = useState<AnalyzeState>(INITIAL_STATE);

  const mounted = useRef(true);
  /** Bumped on every run and on cancel, so a stale promise cannot land. */
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const preparedRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // An upload that outlives its screen is radio time spent on a result
      // nobody will read.
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(() => {
    runId.current += 1;
    const id = runId.current;

    const isCurrent = () => mounted.current && runId.current === id;

    const patch = (next: Partial<AnalyzeState>) => {
      if (!isCurrent()) return;
      setState((current) => ({ ...current, ...next }));
    };

    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      stage: preparedRef.current ? 'uploading' : 'compressing',
      preparedUri: preparedRef.current,
    });

    void (async () => {
      let uploadUri = preparedRef.current;

      if (!uploadUri) {
        try {
          const prepared = await prepareForUpload(imageUri);
          uploadUri = prepared.uri;
          preparedRef.current = prepared.uri;
        } catch {
          // The manipulator failed on this file. That is a verdict on the
          // photo, not on the network, so retrying the same bytes cannot help.
          patch({ stage: 'failed', progress: 0, failure: PREPARE_FAILURE });
          return;
        }

        patch({ stage: 'uploading', progress: 0, preparedUri: uploadUri });
      }

      if (controller.signal.aborted) {
        patch({ stage: 'failed', progress: 0, failure: CANCELLED_FAILURE });
        return;
      }

      try {
        const { log } = await healthApi.analyze({
          cropId,
          imageUri: uploadUri,
          description,
          shareToCommunity,
          signal: controller.signal,
          onUploadProgress: (fraction) => {
            if (!isCurrent()) return;
            const clamped = Math.min(1, Math.max(0, fraction));

            setState((current) => {
              if (current.stage !== 'uploading' && current.stage !== 'analyzing') return current;
              return {
                ...current,
                progress: clamped,
                // Every byte is on the wire; what happens now is the
                // conductor's chain, which is a different sentence.
                stage: clamped >= 1 ? 'analyzing' : 'uploading',
              };
            });
          },
        });

        patch({ stage: 'done', progress: 1, log, failure: null });
      } catch (error) {
        patch({ stage: 'failed', progress: 0, failure: classifyAnalyzeFailure(error) });
      }
    })();
  }, [cropId, description, imageUri, shareToCommunity]);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  }, [run]);

  const retry = useCallback(() => {
    startedRef.current = true;
    run();
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    // Orphan the in-flight run before writing, so its rejection cannot
    // overwrite the cancelled state a moment later.
    runId.current += 1;
    setState((current) => ({
      ...current,
      stage: 'failed',
      progress: 0,
      failure: CANCELLED_FAILURE,
    }));
  }, []);

  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    startedRef.current = true;
    run();
  }, [autoStart, run]);

  return { state, labelKey: STAGE_LABEL_KEY[state.stage], start, retry, cancel };
}
