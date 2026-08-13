/**
 * Photo preparation, before anything touches the network.
 *
 * A modern Android camera produces a 3–8MB JPEG. On the 2G/3G connection this
 * product is designed for, sending that raw is the difference between a scan
 * that completes and one that times out — docs/mobile/camera-and-upload.md
 * asks for "resize ≤1600px, JPEG q85 (typ. 3–8MB → 200–500KB: low-bandwidth
 * requirement)".
 *
 * 1600px is not an arbitrary number: it is the same long edge the server
 * re-encodes to (`MAX_STORED_EDGE_PX` in backend/src/config/constants.js), so
 * compressing here throws away only bytes the server would have discarded
 * anyway. The model sees a 224px crop of this either way.
 *
 * Note what this does NOT do: it does not decide whether the image is
 * acceptable. The server re-reads the magic bytes, re-encodes, and strips EXIF
 * regardless of what arrives — the client copy is a bandwidth optimisation and
 * a privacy courtesy, never the authority.
 */
import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';

/** Matches the server's stored long edge. */
export const MAX_EDGE_PX = 1600;

/** q85 — the documented quality floor for a leaf lesion to stay legible. */
export const JPEG_QUALITY = 0.85;

/**
 * The server's hard ceiling is 8MB (`MAX_UPLOAD_BYTES` in
 * backend/src/config/constants.js). It is deliberately NOT mirrored as a
 * client-side guard: a 1600px JPEG at q85 lands in the 200–500KB range, so a
 * check here would never fire, and an unused constant that looks like a limit
 * reads as a limit that is being enforced. The server rejects an oversized
 * upload with `errors.uploadTooLarge`, which `useAnalyze` already classifies.
 */

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Resizes the long edge to at most `MAX_EDGE_PX` and re-encodes as JPEG.
 *
 * Only the long edge is constrained, and only downward: enlarging a small
 * photo would invent detail the model would then read as real.
 */
export async function prepareForUpload(uri: string): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(uri);
  const original = await context.renderAsync();

  const longEdge = Math.max(original.width, original.height);

  if (longEdge > MAX_EDGE_PX) {
    const scale = MAX_EDGE_PX / longEdge;
    context.resize({
      width: Math.round(original.width * scale),
      height: Math.round(original.height * scale),
    });
  }

  const rendered = await context.renderAsync();
  const saved: ImageResult = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
  });

  return { uri: saved.uri, width: saved.width, height: saved.height };
}
