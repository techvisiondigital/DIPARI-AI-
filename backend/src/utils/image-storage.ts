/**
 * Helpers for turning generated image output into something that is safe both
 * to store on a Firestore document and to hand to a browser or to Meta.
 *
 * Two shapes come back from the image providers and neither can be stored
 * as-is:
 *
 *  - a `data:` URI — the actual bytes, but a Firestore document is capped at
 *    1 MiB, so a 1080x1080 creative usually will not fit;
 *  - an on-demand generation URL (Pollinations) — not a hosted file at all.
 *    Every fetch re-renders the image, takes 20-60s and often times out, so a
 *    browser showing the post gives up and the thumbnail turns into a "Retry"
 *    button. This was the cause of blank images in the content calendar.
 *
 * The fix in both cases is to upload the bytes once, server-side, and store the
 * resulting hosted URL.
 */

/**
 * A Firestore document may not exceed 1 MiB and `imageUrl` is stored on the
 * calendar/post document, so a data URI above this size is dropped rather than
 * inlined — an oversized value would make the write fail outright.
 */
export const MAX_INLINE_IMAGE_BYTES = 280 * 1024;

/** Inlines image bytes as a data URI, but only when small enough to store. */
export function inlineImageIfSmallEnough(buffer: Buffer, contentType: string): string {
  if (!buffer?.length || buffer.length > MAX_INLINE_IMAGE_BYTES) return '';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

/** Extracts the raw bytes and MIME type from a `data:...;base64,...` URI. */
export function decodeDataUri(
  value: string,
): { buffer: Buffer; contentType: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(value || '');
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return null;
  return { buffer, contentType: match[1] };
}

/** Picks the file extension matching a MIME type. */
export function extensionForContentType(contentType: string): string {
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/webp/i.test(contentType)) return 'webp';
  return 'png';
}
