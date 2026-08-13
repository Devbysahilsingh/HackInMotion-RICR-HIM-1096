/**
 * Image sanitization — every uploaded byte passes through here.
 *
 * Implements docs/security/image-upload-security.md steps 2–4. Step 1
 * (transport caps) is multer's job and lives in middleware/uploadImage.js;
 * step 5 (storage) is integrations/cloudinary.js. This module is pure in the
 * sense that matters: it touches no database, no network and no filesystem, so
 * it can be exercised directly by the ST-30 fixtures without a server.
 *
 * ## Why there is no temporary file
 *
 * The security doc says "Local disk: temp file in isolated tmp dir, deleted in
 * finally-block". This implementation keeps the bytes in memory instead, and
 * that is a deliberate strengthening rather than a shortcut: an 8MB ceiling is
 * already enforced before a byte is buffered, sharp decodes from a Buffer, and
 * Cloudinary accepts a stream — so no path is ever constructed from user input,
 * nothing survives a crash between the write and the `finally`, and there is no
 * temp directory for a second process to read. A cleanup step that cannot fail
 * is better than one that is carefully written to.
 *
 * What *does* need cleaning up is the remote asset: if storage succeeds and a
 * later step fails, the orphan is destroyed by the caller. That is the real
 * cleanup-on-failure path and it lives in services/cropHealthService.js.
 *
 * ## Why the order of the checks matters
 *
 * Cheap and certain first, expensive and fallible last: a sniff over the first
 * few bytes rejects a renamed `.exe` without allocating a decoder; a header
 * read rejects a decompression bomb without allocating its pixels; only then is
 * a full decode attempted. Reversing any pair would hand an attacker the more
 * expensive operation for free.
 */
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

import {
  ACCEPTED_IMAGE_EXTENSIONS,
  MAX_DECODE_PIXELS,
  MAX_IMAGE_EDGE_PX,
  MAX_IMAGE_MEGAPIXELS,
  REENCODE_JPEG_QUALITY,
  REENCODE_MAX_EDGE_PX,
  UPLOAD_REJECTION,
} from '../config/constants.js';

/**
 * Image container formats we recognise but do not accept. Separating these from
 * "not an image at all" is what lets the farmer be told something useful —
 * "that format is not supported" rather than "that is not a photo" — without
 * revealing which internal guard fired for a genuinely hostile payload.
 */
const KNOWN_IMAGE_EXTENSIONS = new Set([
  ...ACCEPTED_IMAGE_EXTENSIONS,
  'gif',
  'tif',
  'bmp',
  'jxl',
  'jp2',
  'ico',
  'cur',
  'psd',
  'dng',
  'cr2',
  'nef',
  'arw',
  'orf',
  'rw2',
  'raf',
  'heic-sequence',
  'avif-sequence',
]);

const rejected = (reason, detail) => ({ ok: false, reason, ...(detail ? { detail } : {}) });

/**
 * Step 2 — identity by content, never by claim.
 *
 * `file-type` reads magic bytes only. The multipart part's `Content-Type` and
 * `filename` are never consulted anywhere in this pipeline, which is what makes
 * "rename payload.exe to leaf.jpg" a non-event: the sniff sees `MZ` and the
 * upload is refused before anything else runs.
 *
 * SVG is worth naming explicitly. It is XML, not a raster format, so it is not
 * magic-byte detectable and is not in `KNOWN_IMAGE_EXTENSIONS`; it falls into
 * NOT_AN_IMAGE, which is the correct outcome — an SVG can carry script and must
 * never reach a decoder or a CDN from this route.
 */
export async function sniffFormat(buffer) {
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) return rejected(UPLOAD_REJECTION.NOT_AN_IMAGE);

  if (ACCEPTED_IMAGE_EXTENSIONS.includes(detected.ext)) {
    return { ok: true, ext: detected.ext, mime: detected.mime };
  }

  return rejected(
    KNOWN_IMAGE_EXTENSIONS.has(detected.ext)
      ? UPLOAD_REJECTION.UNSUPPORTED_FORMAT
      : UPLOAD_REJECTION.NOT_AN_IMAGE,
  );
}

/**
 * Step 3 — bomb guards, from the header alone.
 *
 * `sharp.metadata()` parses the container header without decoding pixels, so a
 * 4KB PNG declaring 50000×50000 is refused for a few microseconds of work
 * rather than the ~10GB its pixel buffer would cost. `limitInputPixels` is set
 * on the instance as well, so a file that *lies* in its header and only reveals
 * its true size mid-decode is still aborted by sharp itself.
 *
 * Animated inputs are refused rather than flattened: an animation is not a
 * photograph of a leaf, every frame multiplies decode cost, and silently
 * analysing frame 1 would answer a question the farmer did not ask.
 */
export async function inspectHeader(buffer) {
  let metadata;
  try {
    // Two options here are load-bearing and were both got wrong first time:
    //
    //   `animated: true` — without it sharp reports `pages: undefined` for an
    //   animated WebP and silently treats the frames as one tall still image.
    //   A three-frame animation was accepted and flattened into a 32×96 JPEG,
    //   i.e. the animated guard never fired at all. Only an animation-aware
    //   read populates `pages`.
    //
    //   `limitInputPixels: false` — `metadata()` parses the header and decodes
    //   nothing, so no pixel budget is at risk here. Left at sharp's default
    //   (~268MP) it *throws* on an oversized declaration, which sent a
    //   decompression bomb into the catch below and reported it as "photo could
    //   not be opened" — telling the farmer to retake a photo that was never
    //   the problem, and hiding a bomb behind a corruption message in the logs.
    //   The explicit checks underneath give the honest reason instead; the
    //   decode step still carries the real limit, which is where a pixel budget
    //   actually protects something.
    metadata = await sharp(buffer, { animated: true, limitInputPixels: false }).metadata();
  } catch {
    // A header sharp cannot parse is unreadable, not hostile — the sniff has
    // already established that this is a format we accept.
    return rejected(UPLOAD_REJECTION.UNREADABLE);
  }

  const { width, pages, pageHeight } = metadata;

  // Checked before dimensions: with `animated: true`, `height` is every frame
  // stacked, so an animation would otherwise be reported as an oversized still.
  if (typeof pages === 'number' && pages > 1) return rejected(UPLOAD_REJECTION.ANIMATED);

  // `pageHeight` is the per-frame height when sharp knows about pages, and the
  // whole height otherwise; for a single-page image the two agree.
  const height = pageHeight ?? metadata.height;

  if (!width || !height) return rejected(UPLOAD_REJECTION.UNREADABLE);

  if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
    return rejected(UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE);
  }

  // The security doc states both bounds ("≤6000×6000 AND megapixels ≤36"). At
  // these values the edge cap already subsumes the area cap — 6000×6000 is
  // exactly 36MP — so this branch cannot fire today. It is kept because the two
  // are independent requirements: raising the edge cap without it would quietly
  // raise the area budget too.
  if (width * height > MAX_IMAGE_MEGAPIXELS * 1_000_000) {
    return rejected(UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE);
  }

  return { ok: true, width, height, format: metadata.format };
}

/**
 * Step 4 — decode and re-encode.
 *
 * This is the step that makes the whole route safe, and it is worth being
 * precise about why. A polyglot file — a valid JPEG whose tail is a ZIP, or
 * whose comment segment holds PHP — survives every structural check, because
 * structurally it *is* a JPEG. What it does not survive is being decoded to a
 * pixel array and encoded again from those pixels: the output is synthesised
 * from colour values, so any byte that was not a pixel is simply not carried
 * forward. The appended archive, the script in the comment, the EXIF GPS tag
 * and the ICC profile all cease to exist in the same operation.
 *
 * `rotate()` with no argument applies the EXIF orientation and then drops it,
 * so the image the farmer sees is the image they took while the tag that
 * encoded "which way up" — and everything sitting beside it in the same EXIF
 * block, including the coordinates of the field — is gone.
 *
 * sharp discards metadata by default; nothing here calls `keepMetadata()` or
 * `withMetadata()`, and the ST-30 suite asserts the output is EXIF-free rather
 * than trusting that default to hold across an upgrade.
 */
export async function reencode(buffer) {
  try {
    const jpeg = await sharp(buffer, { limitInputPixels: MAX_DECODE_PIXELS, animated: false })
      .rotate()
      .resize({
        width: REENCODE_MAX_EDGE_PX,
        height: REENCODE_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: REENCODE_JPEG_QUALITY })
      .toBuffer();

    return { ok: true, jpeg };
  } catch {
    // Truncated files, HEICs whose codec this libvips build cannot decode, and
    // files that pass a header check but hold garbage pixels all land here. The
    // farmer is told the photo could not be read and asked to retake it; the
    // decoder's own message is never surfaced, because it names internal
    // offsets and library versions.
    return rejected(UPLOAD_REJECTION.UNREADABLE);
  }
}

/**
 * The whole pipeline.
 *
 * @param {Buffer} buffer raw upload bytes
 * @returns {Promise<
 *   | { ok: true, jpeg: Buffer, hash: string, width: number, height: number,
 *       bytes: number, sourceFormat: string }
 *   | { ok: false, reason: string }
 * >}
 */
export async function sanitizeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return rejected(UPLOAD_REJECTION.NO_FILE);
  }

  const sniffed = await sniffFormat(buffer);
  if (!sniffed.ok) return sniffed;

  const header = await inspectHeader(buffer);
  if (!header.ok) return header;

  const encoded = await reencode(buffer);
  if (!encoded.ok) return encoded;

  // Dimensions are re-read from the *output*, not carried over from the input
  // header: the resize may have changed them, and the stored record should
  // describe the asset that exists rather than the one that was uploaded.
  const finalMeta = await sharp(encoded.jpeg).metadata();

  return {
    ok: true,
    jpeg: encoded.jpeg,
    hash: imageHash(encoded.jpeg),
    width: finalMeta.width,
    height: finalMeta.height,
    bytes: encoded.jpeg.length,
    sourceFormat: sniffed.ext,
  };
}

/**
 * Cache key material.
 *
 * Hashed over the **re-encoded** bytes rather than the upload, and that is the
 * only choice that works: two shots of the same leaf differ in EXIF timestamp,
 * so raw-byte hashes would never collide and the cache would never hit. After
 * re-encoding, the same source photograph deterministically produces the same
 * JPEG, so a genuine re-upload is recognised.
 *
 * Not a security control — an attacker can trivially make two different photos
 * hash differently. It exists to stop a retry burning free-tier quota.
 */
export function imageHash(jpeg) {
  return createHash('sha256').update(jpeg).digest('hex');
}
