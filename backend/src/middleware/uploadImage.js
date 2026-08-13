/**
 * Multipart intake for the two image routes (docs/security/
 * image-upload-security.md step 1: "multipart only on the two upload routes;
 * hard size limit 8MB … single file; field allowlist").
 *
 * Multer is configured to be as small a surface as multer can be:
 *
 *   - **Memory storage.** No `dest`, so no filename is ever derived from user
 *     input and there is no temp file to leak, collide or survive a crash. The
 *     8MB ceiling below is what makes this safe to hold in memory.
 *   - **One field, one file.** `single()` plus explicit `files: 1` and
 *     `parts` caps, so a request carrying twenty parts is refused by the parser
 *     rather than by a later loop.
 *   - **No `fileFilter` deciding on MIME.** Multer's filter only ever sees the
 *     client's claim, and deciding anything on it would contradict the rule
 *     that the claim is ignored. Format is decided by magic bytes in
 *     services/imagePipeline.js, on the bytes themselves.
 *
 * Multer's own errors are translated here into the canonical reason classes so
 * the route never has to know what a `MulterError` is, and so a parser failure
 * cannot reach the generic 500 branch.
 */
import multer from 'multer';

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_FIELD_NAME,
  UPLOAD_REJECTION,
  UPLOAD_REJECTION_KEYS,
} from '../config/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * A rejection the farmer can act on.
 *
 * `details` names the reason class rather than restating it in prose, matching
 * the `{field, rule}` shape every other validation failure uses. The class is
 * coarse by design: it tells an honest user what to fix without telling a
 * hostile one which specific guard they tripped.
 */
export function uploadRejection(reason) {
  const messageKey = UPLOAD_REJECTION_KEYS[reason] ?? UPLOAD_REJECTION_KEYS.NOT_AN_IMAGE;
  return new AppError('UPLOAD_ERROR', messageKey, {
    details: [{ field: UPLOAD_FIELD_NAME, rule: reason }],
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // One file part plus the ordinary text fields the form carries. Bounded so
    // a request cannot cost unbounded parser work before any handler runs.
    parts: 12,
    fields: 10,
    fieldSize: 4096,
    fieldNameSize: 100,
    headerPairs: 100,
  },
}).single(UPLOAD_FIELD_NAME);

/** Multer's error codes → our reason classes. */
const MULTER_REASONS = {
  LIMIT_FILE_SIZE: UPLOAD_REJECTION.TOO_LARGE,
  LIMIT_FILE_COUNT: UPLOAD_REJECTION.TOO_MANY_FILES,
  LIMIT_UNEXPECTED_FILE: UPLOAD_REJECTION.UNEXPECTED_FIELD,
  LIMIT_PART_COUNT: UPLOAD_REJECTION.TOO_MANY_FILES,
  LIMIT_FIELD_COUNT: UPLOAD_REJECTION.UNEXPECTED_FIELD,
  LIMIT_FIELD_KEY: UPLOAD_REJECTION.UNEXPECTED_FIELD,
  LIMIT_FIELD_VALUE: UPLOAD_REJECTION.UNEXPECTED_FIELD,
};

/**
 * Accepts exactly one image part and leaves it on `req.file`.
 *
 * Deliberately does NOT validate the bytes — that is the pipeline's job, and
 * splitting them keeps this file to one concern: what the parser will accept
 * off the wire.
 */
export function uploadImage(req, res, next) {
  upload(req, res, (err) => {
    if (!err) {
      if (!req.file?.buffer?.length) return next(uploadRejection(UPLOAD_REJECTION.NO_FILE));
      return next();
    }

    if (err instanceof multer.MulterError) {
      return next(uploadRejection(MULTER_REASONS[err.code] ?? UPLOAD_REJECTION.NOT_AN_IMAGE));
    }

    // A malformed multipart envelope — busboy could not find a boundary, or the
    // stream ended mid-part. Not a MulterError, and not something to surface
    // verbatim: the message quotes the raw header it choked on.
    return next(uploadRejection(UPLOAD_REJECTION.NOT_AN_IMAGE));
  });
}
