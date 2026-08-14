/**
 * Scheme allowlist for URLs that arrive as *data* rather than as code.
 *
 * Citations (`sourceRefs[].url`) reach the clients as ordinary string fields on
 * an API response. React does not sanitise `href`: a value of
 * `javascript:alert(1)` is copied into the attribute verbatim and runs on click
 * (verified against React 19 — the framework warns in development and renders
 * it anyway). `data:` and `blob:` are the same class of problem one step
 * removed: a `data:text/html` document opened from a link inherits a hostile
 * origin, and `vbscript:`/`file:` are the historical variants.
 *
 * So the render edge decides, and it decides by allowlist rather than denylist:
 * anything that is not plain `http:`/`https:` is refused, including schemes
 * nobody has thought of yet.
 *
 * This is defence in depth, not the only control — these URLs come from the
 * seeded knowledge base (`backend/src/knowledge/*.json`), which is committed
 * and reviewed. It exists because the alternative is a render edge whose safety
 * depends on every future writer of that JSON, and on the response not having
 * been tampered with in transit.
 */

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Returns the URL when it is safe to put in an `href`, or `null` when it is
 * not. Callers render the raw string as text on `null` rather than dropping it:
 * a citation the farmer can read and type by hand is still a citation, and
 * silently hiding it would lose provenance the ● system promises to show.
 *
 * Relative URLs are refused too. Every consumer of this helper is rendering an
 * *external* reference, and a relative value there is a malformed citation, not
 * a link into this app.
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  let parsed: URL;
  try {
    // No base argument on purpose: a relative string throws here and is
    // refused, rather than being resolved against whatever page is current.
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

  // The parsed form, not the input: `new URL()` has already normalised away
  // the tab/newline obfuscation (`java\tscript:`) that browsers strip before
  // dispatching a navigation but a naive string check would not.
  return parsed.toString();
}
