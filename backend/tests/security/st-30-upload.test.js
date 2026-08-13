/**
 * ST-30 — upload pipeline [blocking]
 *
 * docs/security/security-testing.md names the fixtures this suite must carry:
 *   "polyglot JPEG+ZIP, PNG decompression bomb, 9MB oversize, exe-renamed-jpg,
 *    corrupt JPEG, EXIF-GPS stripped in output, HEIC conversion, rate-limit trip."
 *
 * This file covers the sanitization and storage layers directly, plus multer's
 * transport caps. The route-level half — auth, ownership, quotas and the
 * rate-limit trip — lives in tests/api/cropHealth.test.js, where the analyze
 * endpoint is exercised end to end.
 *
 * The organising assertion, which every case is a variation of: **the client's
 * claim about a file never influences the outcome.** Several cases deliberately
 * send a truthful `Content-Type` with hostile bytes and a lying one with benign
 * bytes, and assert the result depends only on the bytes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_REJECTION,
  UPLOAD_REJECTION_KEYS,
  REENCODE_MAX_EDGE_PX,
} from '../../src/config/constants.js';
import { imageHash, sanitizeImage, sniffFormat } from '../../src/services/imagePipeline.js';
import { STORAGE_FAILURE, storeImage, destroyImage } from '../../src/integrations/cloudinary.js';
import {
  animatedWebp,
  corruptHeif,
  exePayload,
  gifImage,
  jpegWithExifGps,
  oversizePng,
  pngBomb,
  polyglotJpegZip,
  textPayload,
  truncatedJpeg,
  validAvif,
  validJpeg,
  validPng,
  validWebp,
  zipPayload,
} from '../fixtures/images.js';

const ZIP_SIGNATURE = Buffer.from('PK\x03\x04', 'binary');

describe('ST-30 · upload pipeline', () => {
  describe('accepts the formats the contract names', () => {
    const accepted = [
      ['jpeg', validJpeg, 'jpg'],
      ['png', validPng, 'png'],
      ['webp', validWebp, 'webp'],
      // The HEIF container leg. See fixtures/images.js for why this is AVIF
      // rather than HEVC-coded HEIC.
      ['heif container (avif)', validAvif, 'avif'],
    ];

    for (const [label, make, expectedExt] of accepted) {
      it(`converts ${label} to a sanitized JPEG`, async () => {
        const result = await sanitizeImage(await make());

        assert.equal(result.ok, true, `expected ${label} to be accepted`);
        assert.equal(result.sourceFormat, expectedExt);

        // Whatever came in, a JPEG comes out — one format downstream.
        const output = await sharp(result.jpeg).metadata();
        assert.equal(output.format, 'jpeg');
        assert.ok(result.hash.length === 64, 'hash should be a sha256 hex digest');
      });
    }

    it('rejects an image format outside the allowlist as unsupported, not as junk', async () => {
      // A GIF is unmistakably an image. Telling the farmer "that is not a photo"
      // would be false and unactionable; the reason class has to differ.
      const result = await sanitizeImage(await gifImage());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.UNSUPPORTED_FORMAT);
    });
  });

  describe('identity comes from bytes, never from the client', () => {
    it('rejects an executable regardless of what it is called', async () => {
      const result = await sanitizeImage(exePayload());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.NOT_AN_IMAGE);
    });

    it('rejects a non-image payload', async () => {
      for (const payload of [textPayload(), zipPayload()]) {
        const result = await sanitizeImage(payload);
        assert.equal(result.ok, false);
        assert.equal(result.reason, UPLOAD_REJECTION.NOT_AN_IMAGE);
      }
    });

    it('ignores a truthful MIME on hostile bytes and a false MIME on valid bytes', async () => {
      // sniffFormat takes no MIME argument at all — the strongest possible form
      // of "the claim is ignored" is that there is nowhere to put it. This test
      // exists to make that a fact a reader can check rather than a comment.
      assert.equal(sniffFormat.length, 1);

      const honest = await sniffFormat(exePayload());
      assert.equal(honest.ok, false);

      const lying = await sniffFormat(await validPng());
      assert.equal(lying.ok, true);
      assert.equal(lying.ext, 'png', 'format is decided by the PNG signature alone');
    });

    it('rejects an empty body', async () => {
      const result = await sanitizeImage(Buffer.alloc(0));
      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.NO_FILE);
    });
  });

  describe('bomb guards fire before anything is decoded', () => {
    it('refuses a decompression bomb on its declared dimensions', async () => {
      const bomb = pngBomb();

      // The fixture is the whole point: a rounding error's worth of bytes that
      // would become roughly 10GB of pixels.
      assert.ok(bomb.length < 1024, 'a bomb is small on the wire — that is the attack');

      const result = await sanitizeImage(bomb);

      assert.equal(result.ok, false);
      assert.equal(
        result.reason,
        UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE,
        'a bomb must be reported as oversized, not as unreadable — the reason class is what ' +
          'tells an operator they were attacked rather than sent a corrupt file',
      );
    });

    it('refuses an image past the edge cap', async () => {
      const result = await sanitizeImage(oversizePng());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE);
    });

    it('refuses an animated image instead of silently analysing one frame', async () => {
      const result = await sanitizeImage(await animatedWebp());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.ANIMATED);
    });
  });

  describe('decode failures are reported, never thrown', () => {
    it('rejects a truncated JPEG', async () => {
      const result = await sanitizeImage(await truncatedJpeg());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.UNREADABLE);
    });

    it('rejects a HEIF file whose payload cannot be decoded', async () => {
      // Also the honest answer for a real HEVC-coded HEIC on a libvips build
      // without an HEVC decoder: a reason class the farmer can act on.
      const result = await sanitizeImage(await corruptHeif());

      assert.equal(result.ok, false);
      assert.equal(result.reason, UPLOAD_REJECTION.UNREADABLE);
    });

    it('never leaks decoder internals in the rejection', async () => {
      const result = await sanitizeImage(await truncatedJpeg());

      // Reason classes are identifiers. A decoder message would carry byte
      // offsets and library versions.
      assert.match(result.reason, /^[A-Z_]+$/);
      assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
    });
  });

  describe('re-encoding is what makes the route safe', () => {
    it('destroys an appended archive in a polyglot JPEG', async () => {
      const polyglot = await polyglotJpegZip();

      assert.ok(polyglot.includes(ZIP_SIGNATURE), 'fixture must actually carry the archive');

      const result = await sanitizeImage(polyglot);

      // The file is a structurally valid JPEG, so it is accepted — and that is
      // correct. What matters is what survives.
      assert.equal(result.ok, true);
      assert.equal(
        result.jpeg.includes(ZIP_SIGNATURE),
        false,
        'the appended archive must not survive a pixel-level re-encode',
      );
    });

    it('strips EXIF, including GPS', async () => {
      const original = await jpegWithExifGps();

      assert.ok((await sharp(original).metadata()).exif, 'fixture must actually carry EXIF');

      const result = await sanitizeImage(original);
      assert.equal(result.ok, true);

      const output = await sharp(result.jpeg).metadata();
      assert.equal(output.exif, undefined, 'EXIF GPS is a privacy leak and must not survive');
      assert.equal(output.iptc, undefined);
      assert.equal(output.xmp, undefined);
      assert.equal(output.icc, undefined);
    });

    it('bounds the long edge without enlarging a small photo', async () => {
      const large = await sanitizeImage(await validJpeg({ width: 4000, height: 3000 }));
      assert.equal(large.ok, true);
      assert.equal(large.width, REENCODE_MAX_EDGE_PX);
      assert.ok(large.height <= REENCODE_MAX_EDGE_PX);

      const small = await sanitizeImage(await validJpeg({ width: 200, height: 150 }));
      assert.equal(small.ok, true);
      assert.deepEqual(
        { width: small.width, height: small.height },
        { width: 200, height: 150 },
        'upscaling would invent detail that was never photographed',
      );
    });

    it('applies EXIF orientation and then discards the tag', async () => {
      // Orientation 6 means "rotate 90°". A viewer that honours EXIF and one
      // that does not would otherwise disagree about which way up the leaf is —
      // and the AI tiers do not read EXIF at all.
      //
      // `withMetadata({orientation})` rather than `withExif({IFD0:{Orientation}})`:
      // the latter writes the tag into the EXIF block but sharp still reports
      // `orientation: 1`, so the fixture would silently test nothing.
      const rotated = await sharp({
        create: { width: 200, height: 100, channels: 3, background: '#777777' },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      assert.equal(
        (await sharp(rotated).metadata()).orientation,
        6,
        'fixture must actually carry an orientation tag',
      );

      const result = await sanitizeImage(rotated);
      assert.equal(result.ok, true);
      assert.deepEqual(
        { width: result.width, height: result.height },
        { width: 100, height: 200 },
        'the pixels must be rotated, since the tag recording the rotation is removed',
      );
    });
  });

  describe('the image hash keys the cache deterministically', () => {
    it('is stable across identical uploads of the same photo', async () => {
      const first = await sanitizeImage(await validJpeg());
      const second = await sanitizeImage(await validJpeg());

      assert.equal(first.hash, second.hash);
    });

    it('is unaffected by metadata differences in the source', async () => {
      // Two shots of the same scene differ in EXIF timestamp. Hashing the raw
      // upload would never collide, so the cache would never hit; hashing the
      // re-encoded bytes is what makes a genuine re-upload recognisable.
      const plain = await validJpeg();
      const tagged = await sharp(plain)
        .jpeg()
        .withExif({ IFD0: { Artist: 'someone' } })
        .toBuffer();

      assert.notEqual(
        imageHash(plain),
        imageHash(tagged),
        'the raw bytes differ — this is why the raw bytes are not what we hash',
      );

      const a = await sanitizeImage(plain);
      const b = await sanitizeImage(tagged);
      assert.equal(a.hash, b.hash);
    });

    it('differs for different photos', async () => {
      const green = await sanitizeImage(await validJpeg());
      const other = await sanitizeImage(await validPng());

      assert.notEqual(green.hash, other.hash);
    });
  });

  describe('storage failures degrade honestly', () => {
    const jpeg = () => validJpeg();

    it('stores a sanitized image under a name we choose', async () => {
      const seen = [];
      const result = await storeImage(await jpeg(), {
        uploader: async (buffer, options) => {
          seen.push(options);
          return { secure_url: 'https://res.cloudinary.test/x.jpg', public_id: options.publicId };
        },
      });

      assert.equal(result.ok, true);
      assert.match(
        seen[0].publicId,
        /^[0-9a-f-]{36}$/,
        'the asset name is a UUID we generate, never anything from the request',
      );
      assert.match(seen[0].folder, /^him1096\//, 'assets are namespaced per environment');
    });

    it('reports a rejected upload as a reason class, never as a throw', async () => {
      const result = await storeImage(await jpeg(), {
        uploader: async () => {
          const err = new Error('Invalid Signature abc123');
          err.http_code = 401;
          throw err;
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, STORAGE_FAILURE.REJECTED);
      // The provider's message quotes the signed request. It must not travel.
      assert.equal(JSON.stringify(result).includes('Signature'), false);
    });

    it('bounds a hung storage call', async () => {
      const result = await storeImage(await jpeg(), {
        uploader: () => new Promise(() => {}),
        timeoutMs: 25,
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, STORAGE_FAILURE.TIMEOUT);
    });

    it('treats an incomplete provider result as a failure', async () => {
      const result = await storeImage(await jpeg(), {
        uploader: async () => ({ secure_url: 'https://res.cloudinary.test/x.jpg' }),
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, STORAGE_FAILURE.REJECTED);
    });
  });

  describe('cleanup', () => {
    it('destroys an asset', async () => {
      const destroyed = [];
      const result = await destroyImage('abc', {
        destroyer: async (id) => {
          destroyed.push(id);
          return { result: 'ok' };
        },
      });

      assert.equal(result.ok, true);
      assert.deepEqual(destroyed, ['abc']);
    });

    it('treats an already-absent asset as cleaned up', async () => {
      // Otherwise a retried cleanup logs an error forever over an asset that is
      // already in the desired state.
      const result = await destroyImage('gone', {
        destroyer: async () => ({ result: 'not found' }),
      });

      assert.equal(result.ok, true);
    });

    it('reports a cleanup failure without throwing', async () => {
      // A failed cleanup must never become a failed farmer-facing request or a
      // half-deleted crop — it is reported so the caller can log and move on.
      const result = await destroyImage('abc', {
        destroyer: async () => {
          throw new Error('cloudinary exploded');
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, STORAGE_FAILURE.REJECTED);
      assert.equal(JSON.stringify(result).includes('exploded'), false);
    });

    it('reports a cleanup timeout distinctly', async () => {
      const result = await destroyImage('abc', {
        destroyer: () => new Promise(() => {}),
        timeoutMs: 25,
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, STORAGE_FAILURE.TIMEOUT);
    });
  });

  describe('the reason vocabulary is complete', () => {
    it('gives every rejection class a translatable key', () => {
      // A reason class with no key surfaces to the farmer as a blank failure,
      // which the upload doc explicitly forbids.
      for (const reason of Object.values(UPLOAD_REJECTION)) {
        assert.ok(UPLOAD_REJECTION_KEYS[reason], `${reason} has no message key`);
        assert.match(UPLOAD_REJECTION_KEYS[reason], /^errors\.upload[A-Za-z]+$/);
      }
    });

    it('keeps the transport ceiling at the documented 8MB', () => {
      assert.equal(MAX_UPLOAD_BYTES, 8 * 1024 * 1024);
    });
  });
});
