/**
 * Cloudinary — image storage (docs/security/image-upload-security.md step 5).
 *
 * Only the re-encoded JPEG ever reaches this module. The original upload bytes
 * are discarded by the pipeline and never leave the process, so whatever a
 * polyglot carried is gone before storage is involved at all.
 *
 * Four properties this module exists to hold:
 *
 *   - **Signed uploads only.** The SDK is driven with the server-side API
 *     secret; no unsigned preset is created or used, so nothing can be written
 *     into the account without the key that lives in backend env alone.
 *   - **We choose the name.** `public_id` is a v4 UUID. The client's filename
 *     is never used, so no path segment, extension or traversal sequence from a
 *     hostile upload can influence where the asset lands.
 *   - **The URL is not a capability.** Cloudinary URLs are unguessable but they
 *     are not access-controlled, so AU-5 makes the *log* the ownership boundary
 *     and `imagePublicId` is `select: false` on the model — the id needed to
 *     manipulate an asset is never served.
 *   - **Failures are coarse.** Cloudinary's error bodies quote the request,
 *     which carries the signature. Only a reason class crosses this boundary.
 *
 * Unlike the weather and market integrations this one IS on a request path.
 * That is not a violation of the DB-first rule (CLAUDE.md rule 3), which is
 * about *reads* of provider data: an upload has nothing to read from cache, and
 * docs/api/crop-health.md specifies the store as an inline step of the analyze
 * request.
 */
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

import { CLOUDINARY_FOLDER_PREFIX, CLOUDINARY_TIMEOUT_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { failureInjected, injectedDelayMs } from '../config/failureFlags.js';
import { logger } from '../utils/logger.js';

export const CLOUDINARY_PROVIDER = 'cloudinary';

/** Coarse, safe-to-log failure kinds. Mirrors PROVIDER_FAILURE in httpClient. */
export const STORAGE_FAILURE = {
  NOT_CONFIGURED: 'not_configured',
  TIMEOUT: 'timeout',
  REJECTED: 'rejected',
  INJECTED: 'injected',
};

/**
 * Configured lazily and once.
 *
 * The SDK keeps credentials in module-level global state, so configuring it at
 * import time would mean a test that never uploads anything still mutates that
 * global. Doing it on first use keeps the blast radius to callers that actually
 * store something.
 */
let configured = false;

function ensureConfigured() {
  if (!env.CLOUDINARY_URL) return false;
  if (!configured) {
    // The SDK reads CLOUDINARY_URL from the environment itself; passing
    // `secure` explicitly is what guarantees https URLs rather than relying on
    // an account-level default that an operator could flip.
    cloudinary.config({ secure: true });
    configured = true;
  }
  return true;
}

/** `him1096/development/…` — staging assets can never land beside production. */
export const uploadFolder = () => `${CLOUDINARY_FOLDER_PREFIX}/${env.NODE_ENV}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stores one sanitized JPEG.
 *
 * @param {Buffer} jpeg re-encoded bytes — never the raw upload
 * @param {{ uploader?: Function, timeoutMs?: number }} [options] `uploader` is
 *   an injection seam so the suites can exercise success, rejection and timeout
 *   without an account and without network access; `timeoutMs` lets them prove
 *   the bound fires without spending the real one on every run. Production
 *   passes neither.
 * @returns {Promise<
 *   | { ok: true, url: string, publicId: string, bytes: number }
 *   | { ok: false, reason: string }
 * >}
 */
export async function storeImage(jpeg, { uploader, timeoutMs = CLOUDINARY_TIMEOUT_MS } = {}) {
  if (failureInjected(CLOUDINARY_PROVIDER)) {
    return { ok: false, reason: STORAGE_FAILURE.INJECTED };
  }

  const upload = uploader ?? defaultUploader;

  if (!uploader && !ensureConfigured()) {
    // Configuration state, not a provider fault — reported honestly so the
    // conductor can say "storage unavailable" rather than "upload failed".
    return { ok: false, reason: STORAGE_FAILURE.NOT_CONFIGURED };
  }

  const delay = injectedDelayMs(CLOUDINARY_PROVIDER);
  if (delay) await sleep(delay);

  // We name the asset; the client never does.
  const publicId = randomUUID();

  try {
    const result = await withTimeout(upload(jpeg, { publicId, folder: uploadFolder() }), timeoutMs);

    if (!result?.secure_url || !result?.public_id) {
      logger.warn({ provider: CLOUDINARY_PROVIDER }, 'storage returned an incomplete result');
      return { ok: false, reason: STORAGE_FAILURE.REJECTED };
    }

    return {
      ok: true,
      url: result.secure_url,
      publicId: result.public_id,
      bytes: result.bytes ?? jpeg.length,
    };
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError' ? STORAGE_FAILURE.TIMEOUT : STORAGE_FAILURE.REJECTED;
    // The error object is not logged: Cloudinary attaches the signed request to
    // it, and the signature is derived from the API secret.
    logger.warn({ provider: CLOUDINARY_PROVIDER, reason }, 'image storage failed');
    return { ok: false, reason };
  }
}

/**
 * Removes an asset.
 *
 * Used for two things: the orphan left behind when a step after storage fails,
 * and cascade deletion of a crop's history. Both are best-effort by design —
 * an undeletable asset must never turn into a failed farmer-facing request or a
 * half-deleted crop — so this reports rather than throws, and the caller logs.
 */
export async function destroyImage(
  publicId,
  { destroyer, timeoutMs = CLOUDINARY_TIMEOUT_MS } = {},
) {
  if (!publicId) return { ok: false, reason: STORAGE_FAILURE.REJECTED };

  const destroy = destroyer ?? defaultDestroyer;
  if (!destroyer && !ensureConfigured()) {
    return { ok: false, reason: STORAGE_FAILURE.NOT_CONFIGURED };
  }

  try {
    const result = await withTimeout(destroy(publicId), timeoutMs);
    // Cloudinary answers `{result: 'not found'}` with a 200 for an id that is
    // already gone. That is the desired end state, so it counts as success —
    // otherwise a retried cleanup would log an error forever.
    const outcome = result?.result;
    return outcome === 'ok' || outcome === 'not found'
      ? { ok: true }
      : { ok: false, reason: STORAGE_FAILURE.REJECTED };
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError' ? STORAGE_FAILURE.TIMEOUT : STORAGE_FAILURE.REJECTED;
    logger.warn({ provider: CLOUDINARY_PROVIDER, reason }, 'image cleanup failed');
    return { ok: false, reason };
  }
}

/**
 * The SDK's stream upload, promisified.
 *
 * `resource_type: 'image'` is pinned rather than left to `auto`: with `auto`,
 * a payload Cloudinary decided was not an image would be stored as a raw file
 * and served back with its original bytes — which is precisely the outcome
 * re-encoding exists to prevent. Our own pipeline has already proven this is a
 * JPEG, so anything Cloudinary disagrees about should fail, not degrade.
 */
function defaultUploader(jpeg, { publicId, folder }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        folder,
        resource_type: 'image',
        format: 'jpg',
        // Nothing about the asset is derived from the request, so there is no
        // reason to let Cloudinary infer anything from it either.
        use_filename: false,
        unique_filename: false,
        overwrite: false,
        invalidate: false,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(jpeg);
  });
}

const defaultDestroyer = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });

/**
 * The SDK exposes a `timeout` option that it does not apply to every transport
 * path, so the bound is enforced here where it cannot be missed. A hung storage
 * call would otherwise hold an analyze request open past its 15s budget.
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('storage timeout');
      err.name = 'TimeoutError';
      reject(err);
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
