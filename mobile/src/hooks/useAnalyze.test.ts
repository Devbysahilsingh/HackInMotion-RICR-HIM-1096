/**
 * The upload state machine, driven against a mocked `healthApi.analyze`.
 *
 * docs/mobile/testing.md scopes the unit suite to "hooks + services
 * (jest-expo): useAnalyze state machine, …" and this is that. What it is
 * really guarding is the two promises the hero flow makes to a farmer standing
 * in a field: a failure that was not the photograph's fault never asks for a
 * new photograph, and a retry never re-sends bytes it had to make again.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ApiError } from '@shared/client/errors';
import type { HealthLog } from '@shared/types/api';

import { healthApi } from '../api/endpoints';
import { prepareForUpload } from '../services/image';
import { classifyAnalyzeFailure, STAGE_LABEL_KEY, useAnalyze } from './useAnalyze';

jest.mock('../api/endpoints', () => ({ healthApi: { analyze: jest.fn() } }));
jest.mock('../services/image', () => ({ prepareForUpload: jest.fn() }));

const analyze = healthApi.analyze as jest.MockedFunction<typeof healthApi.analyze>;
const prepare = prepareForUpload as jest.MockedFunction<typeof prepareForUpload>;

const RAW_URI = 'file:///camera/raw.jpg';
const PREPARED_URI = 'file:///cache/prepared.jpg';

const PREPARED = { uri: PREPARED_URI, width: 1600, height: 1200 };

function makeLog(): HealthLog {
  return {
    id: 'log-1',
    cropId: 'crop-1',
    imageUrl: 'https://example.test/leaf.jpg',
    description: null,
    status: 'analyzed',
    sharedToCommunity: false,
    createdAt: '2026-08-13T06:00:00.000Z',
    analysis: {
      source: 'ml',
      sourceLabelKey: 'health.sourceLocalAi',
      diseaseCode: 'TOMATO_EARLY_BLIGHT',
      confidence: 0.82,
      severityAssessment: 'MODERATE',
      escalated: false,
      modelVersion: 'stub-0.0.0-untrained',
      top3: [{ diseaseCode: 'TOMATO_EARLY_BLIGHT', confidence: 0.82 }],
      escalationPath: [{ provider: 'ml', reason: 'ACCEPTED' }],
    },
    recommendation: { titleKey: 'health.titleMl', data: {} },
    severityFollowUp: null,
    coverageNoticeKey: null,
    freshness: { status: 'live', source: 'ml', fetchedAt: '2026-08-13T06:00:00.000Z' },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A promise that never settles — used to pin the machine on one stage. */
const pending = <T>(): Promise<T> => new Promise<T>(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  prepare.mockResolvedValue(PREPARED);
});

describe('classifyAnalyzeFailure', () => {
  it('treats a dropped connection as retryable with the same photo', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'NETWORK_ERROR', messageKey: 'errors.network' }),
    );

    expect(failure).toMatchObject({
      kind: 'network',
      canRetrySameImage: true,
      needsNewPhoto: false,
    });
  });

  it('treats a timeout as retryable with the same photo', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'TIMEOUT', messageKey: 'errors.network', status: null }),
    );

    expect(failure.kind).toBe('network');
    expect(failure.canRetrySameImage).toBe(true);
  });

  it('asks for a new photo when the server rejected the image itself', () => {
    for (const rule of [
      'TOO_LARGE',
      'UNSUPPORTED_FORMAT',
      'DIMENSIONS_TOO_LARGE',
      'ANIMATED',
      'UNREADABLE',
      'NOT_AN_IMAGE',
    ]) {
      const failure = classifyAnalyzeFailure(
        new ApiError({
          code: 'UPLOAD_ERROR',
          messageKey: 'errors.uploadUnsupportedFormat',
          status: 400,
          details: [{ field: 'image', rule }],
        }),
      );

      expect(failure).toMatchObject({
        kind: 'photoRejected',
        rule,
        needsNewPhoto: true,
        canRetrySameImage: false,
      });
    }
  });

  it('does NOT ask for a new photo when storage was briefly unavailable', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({
        code: 'UPLOAD_ERROR',
        messageKey: 'errors.uploadStorageUnavailable',
        status: 400,
        details: [{ field: 'image', rule: 'STORAGE_UNAVAILABLE' }],
      }),
    );

    expect(failure).toMatchObject({
      kind: 'server',
      needsNewPhoto: false,
      canRetrySameImage: true,
      messageKey: 'errors.uploadStorageUnavailable',
    });
  });

  it('does NOT ask for a new photo when the part never arrived', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({
        code: 'UPLOAD_ERROR',
        messageKey: 'errors.uploadNoFile',
        status: 400,
        details: [{ field: 'image', rule: 'NO_FILE' }],
      }),
    );

    expect(failure.needsNewPhoto).toBe(false);
    expect(failure.canRetrySameImage).toBe(true);
  });

  it('classifies a 429 as rate limited rather than as a network failure', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'RATE_LIMITED', messageKey: 'errors.rateLimited', status: 429 }),
    );

    expect(failure).toMatchObject({
      kind: 'rateLimited',
      status: 429,
      messageKey: 'errors.rateLimited',
      needsNewPhoto: false,
    });
  });

  it("carries the server's Retry-After through to the screen", () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({
        code: 'RATE_LIMITED',
        messageKey: 'errors.rateLimited',
        status: 429,
        retryAfterSeconds: 42,
      }),
    );

    expect(failure.retryAfterSeconds).toBe(42);
  });

  it('leaves the wait null when the 429 carried no Retry-After', () => {
    // The screen falls back to "wait a little" rather than naming a duration
    // nobody measured (rule 7).
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'RATE_LIMITED', messageKey: 'errors.rateLimited', status: 429 }),
    );

    expect(failure.retryAfterSeconds).toBeNull();
  });

  it('classifies a 5xx as ours and retryable', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'INTERNAL_ERROR', messageKey: 'errors.internal', status: 502 }),
    );

    expect(failure).toMatchObject({ kind: 'server', canRetrySameImage: true });
  });

  it('classifies an ownership 404 as a rejection with no retry', () => {
    const failure = classifyAnalyzeFailure(
      new ApiError({ code: 'NOT_FOUND', messageKey: 'errors.notFound', status: 404 }),
    );

    expect(failure).toMatchObject({
      kind: 'rejected',
      canRetrySameImage: false,
      needsNewPhoto: false,
    });
  });

  it('never leaks a non-ApiError to the screen', () => {
    const failure = classifyAnalyzeFailure(new Error('boom'));

    expect(failure.messageKey).toBe('errors.internal');
    expect(failure.kind).toBe('server');
  });
});

describe('useAnalyze', () => {
  it('does nothing until started when autoStart is off', () => {
    const { result } = renderHook(() =>
      useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI, autoStart: false }),
    );

    expect(result.current.state.stage).toBe('idle');
    expect(result.current.labelKey).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('opens in compressing while the photo is being re-encoded', () => {
    prepare.mockReturnValue(pending());

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));

    expect(result.current.state.stage).toBe('compressing');
    expect(result.current.labelKey).toBe('mobile:upload.compressing');
  });

  it('walks compressing → uploading → analyzing → done', async () => {
    const call = deferred<{ log: HealthLog }>();
    let report: ((fraction: number) => void) | undefined;

    analyze.mockImplementation((input) => {
      report = input.onUploadProgress;
      return call.promise;
    });

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));

    await waitFor(() => expect(result.current.state.stage).toBe('uploading'));
    expect(result.current.state.preparedUri).toBe(PREPARED_URI);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ imageUri: PREPARED_URI }));

    act(() => report?.(0.4));
    expect(result.current.state.stage).toBe('uploading');
    expect(result.current.state.progress).toBeCloseTo(0.4);
    expect(result.current.labelKey).toBe('mobile:upload.uploading');

    // Every byte delivered — what happens now is the server's chain, which is
    // a different sentence.
    act(() => report?.(1));
    expect(result.current.state.stage).toBe('analyzing');
    expect(result.current.labelKey).toBe('mobile:upload.analyzing');

    const log = makeLog();
    await act(async () => {
      call.resolve({ log });
    });

    await waitFor(() => expect(result.current.state.stage).toBe('done'));
    expect(result.current.state.log).toBe(log);
    expect(result.current.state.failure).toBeNull();
  });

  it('clamps a progress fraction outside 0–1', async () => {
    let report: ((fraction: number) => void) | undefined;
    analyze.mockImplementation((input) => {
      report = input.onUploadProgress;
      return pending();
    });

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));
    await waitFor(() => expect(result.current.state.stage).toBe('uploading'));

    act(() => report?.(-3));
    expect(result.current.state.progress).toBe(0);

    act(() => report?.(4));
    expect(result.current.state.progress).toBe(1);
  });

  it('fails with prepareFailed, and asks for a new photo, when the file cannot be decoded', async () => {
    prepare.mockRejectedValue(new Error('cannot decode'));

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));

    await waitFor(() => expect(result.current.state.stage).toBe('failed'));
    expect(result.current.state.failure).toMatchObject({
      kind: 'prepareFailed',
      needsNewPhoto: true,
      canRetrySameImage: false,
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('classifies a network failure and keeps the prepared photo', async () => {
    analyze.mockRejectedValue(
      new ApiError({ code: 'NETWORK_ERROR', messageKey: 'errors.network' }),
    );

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));

    await waitFor(() => expect(result.current.state.stage).toBe('failed'));
    expect(result.current.state.failure?.kind).toBe('network');
    expect(result.current.state.failure?.canRetrySameImage).toBe(true);
  });

  it('retries with the SAME bytes rather than re-compressing', async () => {
    analyze.mockRejectedValueOnce(
      new ApiError({ code: 'NETWORK_ERROR', messageKey: 'errors.network' }),
    );
    const log = makeLog();
    analyze.mockResolvedValueOnce({ log });

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));

    await waitFor(() => expect(result.current.state.stage).toBe('failed'));

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.state.stage).toBe('done'));

    // The whole point of RES-10: one compression, two sends.
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls.every(([input]) => input.imageUri === PREPARED_URI)).toBe(true);
  });

  it('aborts the in-flight request on cancel and never lands its result', async () => {
    const call = deferred<{ log: HealthLog }>();
    let signal: AbortSignal | undefined;

    analyze.mockImplementation((input) => {
      signal = input.signal;
      return call.promise;
    });

    const { result } = renderHook(() => useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }));
    await waitFor(() => expect(result.current.state.stage).toBe('uploading'));

    act(() => result.current.cancel());

    expect(signal?.aborted).toBe(true);
    expect(result.current.state.stage).toBe('failed');
    expect(result.current.state.failure?.kind).toBe('cancelled');

    // A cancelled request that resolves late must not resurrect the flow.
    await act(async () => {
      call.resolve({ log: makeLog() });
    });

    expect(result.current.state.stage).toBe('failed');
    expect(result.current.state.log).toBeNull();
  });

  it('aborts the upload when the screen goes away', async () => {
    let signal: AbortSignal | undefined;
    analyze.mockImplementation((input) => {
      signal = input.signal;
      return pending();
    });

    const { result, unmount } = renderHook(() =>
      useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI }),
    );
    await waitFor(() => expect(result.current.state.stage).toBe('uploading'));

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('passes the community opt-in and the crop through unchanged', async () => {
    analyze.mockResolvedValue({ log: makeLog() });

    const { result } = renderHook(() =>
      useAnalyze({ cropId: 'crop-9', imageUri: RAW_URI, shareToCommunity: true }),
    );

    await waitFor(() => expect(result.current.state.stage).toBe('done'));
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ cropId: 'crop-9', shareToCommunity: true }),
    );
  });

  it('start() is idempotent — a double tap cannot double-send', async () => {
    analyze.mockReturnValue(pending());

    const { result } = renderHook(() =>
      useAnalyze({ cropId: 'crop-1', imageUri: RAW_URI, autoStart: false }),
    );

    await act(async () => {
      result.current.start();
      result.current.start();
    });

    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  });

  it('names every stage it can show, and only those', () => {
    expect(STAGE_LABEL_KEY).toEqual({
      idle: null,
      compressing: 'mobile:upload.compressing',
      uploading: 'mobile:upload.uploading',
      analyzing: 'mobile:upload.analyzing',
      done: 'mobile:upload.preparing',
      failed: null,
    });
  });
});
