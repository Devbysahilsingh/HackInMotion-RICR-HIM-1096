/**
 * ST-30 image fixtures.
 *
 * Every fixture is **generated**, never committed as a binary. Three reasons:
 * a decompression bomb and a polyglot are exactly the files a repository should
 * not carry; generated fixtures state their own construction, so a reviewer can
 * see what makes each one hostile instead of trusting a filename; and sharp is
 * already a dependency, so there is nothing to install.
 *
 * Everything is async because sharp is.
 */
import zlib from 'node:zlib';
import sharp from 'sharp';

/** A plain, valid photo-shaped JPEG. The control case. */
export const validJpeg = ({ width = 240, height = 180 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#3a7d2c' } })
    .jpeg({ quality: 90 })
    .toBuffer();

export const validPng = ({ width = 120, height = 90 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#8b5a2b' } })
    .png()
    .toBuffer();

export const validWebp = ({ width = 120, height = 90 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#2b5a8b' } })
    .webp()
    .toBuffer();

/**
 * A HEIF-container image.
 *
 * This is AVIF, not HEVC-coded HEIC, and the distinction is honest rather than
 * incidental: producing a real HEIC requires an HEVC *encoder*, which this
 * libvips build does not have (`heifsave: Unsupported compression`). So the
 * heif container path is proven end-to-end here, while HEVC-payload decoding is
 * covered only by `corruptHeif` below — see that fixture's note.
 */
export const validAvif = ({ width = 96, height = 96 } = {}) =>
  sharp({ create: { width, height, channels: 3, background: '#6a4c93' } })
    .avif({ quality: 50 })
    .toBuffer();

/** GIF — a real image, deliberately outside the allowlist. */
export const gifImage = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#111111' } })
    .gif()
    .toBuffer();

/**
 * A JPEG carrying EXIF, including a GPS tag.
 *
 * GPS is the point: a photo taken in a field carries the field's coordinates,
 * and forwarding that to an AI provider or a CDN would leak the farmer's
 * location. The suite asserts the pipeline's output has no EXIF block at all.
 */
export async function jpegWithExifGps() {
  return sharp({ create: { width: 200, height: 150, channels: 3, background: '#4b7f52' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'HIM-1096 fixture', Make: 'FixtureCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .toBuffer();
}

/** Anything over the multer ceiling. Incompressible so it cannot shrink. */
export const oversizeBytes = (bytes) => Buffer.alloc(bytes, 0xab);

/** A Windows executable. The classic "rename it .jpg" attempt. */
export const exePayload = () =>
  Buffer.concat([Buffer.from('MZ\x90\x00\x03', 'binary'), Buffer.alloc(1024, 0x01)]);

/** Not a container at all — no magic bytes match. */
export const textPayload = () => Buffer.from('#!/bin/sh\necho this is not an image\n');

/** A real ZIP. Detectable, and not an image. */
export const zipPayload = () =>
  Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.alloc(256, 0x02)]);

/** A JPEG cut in half — headers fine, pixel data gone. */
export async function truncatedJpeg() {
  const jpeg = await validJpeg();
  return jpeg.subarray(0, Math.floor(jpeg.length * 0.4));
}

/**
 * A truncated HEIF file.
 *
 * Stands in for the HEIC-we-cannot-decode case: the container parses, the codec
 * payload does not. The pipeline must answer with the reason class "could not
 * be opened" rather than crashing or leaking libheif's offset message.
 */
export async function corruptHeif() {
  const avif = await validAvif();
  return avif.subarray(0, Math.floor(avif.length * 0.6));
}

/**
 * A polyglot: a structurally valid JPEG with an appended ZIP archive.
 *
 * Every structural check passes, because structurally it *is* a JPEG. Only the
 * decode-and-re-encode step removes the archive, which is what makes this the
 * single most important fixture in the suite.
 */
export async function polyglotJpegZip() {
  const jpeg = await validJpeg();
  return Buffer.concat([jpeg, zipPayload()]);
}

// ── PNG construction, for files sharp will not produce ───────────────────────

function crc32(buffer) {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A PNG whose IHDR *declares* enormous dimensions while the file stays tiny.
 *
 * This is a decompression bomb in its purest form: 69 bytes on the wire, and
 * 2.5 billion pixels — roughly 10GB — if anything ever decodes it. The guard
 * under test reads the header and refuses before allocating a single row.
 */
export function pngBomb({ width = 50_000, height = 50_000 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(100))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Dimensions past the 6000px edge cap, but a plausible pixel count. */
export const oversizePng = () => pngBomb({ width: 7000, height: 100 });

/**
 * A genuinely animated WebP.
 *
 * sharp cannot author one — `.webp({pageHeight})` only splits an input that
 * already has pages — so the container is assembled by hand around a real VP8
 * frame that sharp *did* encode. Without this fixture the animated guard is
 * untestable, and it was in fact broken until this file caught it: a
 * three-frame animation was being flattened into one tall still image and
 * analysed as if it were a photograph.
 */
export async function animatedWebp() {
  const still = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#4a2' },
  })
    .webp()
    .toBuffer();

  // Walk the RIFF chunk list for the compressed frame sharp produced.
  let offset = 12;
  let fourcc = null;
  let frameData = null;
  while (offset < still.length) {
    const code = still.toString('ascii', offset, offset + 4);
    const size = still.readUInt32LE(offset + 4);
    if (code === 'VP8 ' || code === 'VP8L') {
      fourcc = code;
      frameData = still.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!frameData) throw new Error('fixture: no VP8 chunk in sharp WebP output');

  const uint24 = (value) => {
    const buffer = Buffer.alloc(3);
    buffer.writeUIntLE(value, 0, 3);
    return buffer;
  };

  const riffChunk = (code, payload) => {
    const header = Buffer.alloc(8);
    header.write(code, 0, 'ascii');
    header.writeUInt32LE(payload.length, 4);
    // RIFF chunks are word-aligned.
    const pad = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([header, payload, pad]);
  };

  // VP8X flags bit 1 = ANIMATION; canvas dimensions are stored minus one.
  const vp8x = riffChunk(
    'VP8X',
    Buffer.concat([Buffer.from([0x02, 0, 0, 0]), uint24(31), uint24(31)]),
  );
  const anim = riffChunk('ANIM', Buffer.from([0, 0, 0, 0, 0, 0]));
  const frame = () =>
    riffChunk(
      'ANMF',
      Buffer.concat([
        uint24(0), // x
        uint24(0), // y
        uint24(31), // width - 1
        uint24(31), // height - 1
        uint24(50), // duration ms
        Buffer.from([0]), // flags
        riffChunk(fourcc, frameData),
      ]),
    );

  const body = Buffer.concat([vp8x, anim, frame(), frame()]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + body.length);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), size, Buffer.from('WEBP', 'ascii'), body]);
}

/**
 * Builds a multipart body by hand.
 *
 * `FormData` + `fetch` would be shorter, but it always sends a well-formed
 * envelope — and several ST-30 cases are specifically about malformed ones
 * (no file part, two file parts, a wrong field name). Constructing the bytes is
 * the only way to send those.
 *
 * @param {{ name: string, filename?: string, contentType?: string, value: Buffer|string }[]} parts
 */
export function multipartBody(parts, boundary = '----HIM1096FixtureBoundary') {
  const chunks = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const headers =
      `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
      (part.contentType ? `Content-Type: ${part.contentType}\r\n` : '') +
      '\r\n';
    chunks.push(Buffer.from(headers, 'utf8'));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
