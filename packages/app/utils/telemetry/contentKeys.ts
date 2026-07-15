/**
 * contentKeys.ts — the single source of truth for object keys whose VALUES
 * must never leave the device in telemetry (crash reports) or, later, product
 * analytics. This module is intentionally dependency-free (no SDK, no
 * platform-only imports) so it is safe to import from shared code, from the
 * web/desktop/native init wrappers, and from pure unit tests running under
 * Vitest.
 *
 * WHY THIS EXISTS
 * ----------------
 * Journal entry bodies and Collective post bodies are user prose. They must be
 * structurally excluded from telemetry — enforced in code (a redactor +
 * heuristic) rather than left to reviewer vigilance. This list is the primary
 * net; the free-text heuristic below is the secondary, independent net.
 *
 * CROSS-SURFACE SYNC (keep these aligned by hand — they are NOT one import):
 *  - The product-analytics denylist reuses this same list.
 *  - The Deno/Edge server-side logger keeps a MIRROR of this list at
 *    `supabase/functions/_shared/contentKeys.ts`. Edge Functions run in a
 *    separate runtime/bundle and CANNOT import from `packages/app`, so that
 *    copy is intentionally synchronized, not shared. If you add a content key
 *    here, add it there too.
 *
 * EXTENDING THIS LIST
 * -------------------
 * Whenever a new user-authored free-text field is introduced anywhere in the
 * product, add its object key here. The heuristic will catch long prose even
 * under an unenumerated key, but SHORT content (a one-word note) below the
 * length threshold will only be caught by an exact key match — so this list
 * remains the primary guarantee.
 */

/**
 * Object keys whose values are known to hold user-authored content. Matching
 * is case-insensitive (see `isContentKey`), so casing variants such as `Body`,
 * `postBody`, `flowContent` are all covered without enumerating each variant.
 */
export const KNOWN_CONTENT_KEYS = ['body', 'content', 'flowContent', 'postBody', 'note'] as const

/** Lowercased set for O(1) case-insensitive membership checks. */
const CONTENT_KEY_SET = new Set<string>(KNOWN_CONTENT_KEYS.map((key) => key.toLowerCase()))

/**
 * Case-insensitive membership test against `KNOWN_CONTENT_KEYS`.
 * `Body`, `POSTBODY`, `flowcontent` all return true.
 */
export function isContentKey(key: string): boolean {
  return CONTENT_KEY_SET.has(key.toLowerCase())
}

/**
 * Minimum character length before a string is even considered for the
 * free-text net. Deliberately keeps genuine error messages and stack frames
 * (which are short and technical) below the bar so they are preserved for
 * debugging — e.g. `'TypeError: x is undefined'`.
 */
const FREE_TEXT_MIN_LENGTH = 60

/**
 * Minimum word count. Prose is many-worded; a technical token or short error
 * string is not. Combined with the length floor this is what "sentence-shaped"
 * means here.
 */
const FREE_TEXT_MIN_WORDS = 6

/**
 * Heuristic: does this string look like user-supplied prose (a journal
 * sentence, a Collective post) rather than a technical error message?
 *
 * INTENT: catch long, multi-word, sentence-shaped content that has been placed
 * under an OFF-LIST key (e.g. `userNote`, `draftText`) so it cannot slip
 * through just because the key was not enumerated in `KNOWN_CONTENT_KEYS`.
 *
 * We flag a string only when BOTH hold:
 *  - it is long (>= 60 chars), AND
 *  - it is many-worded (>= 6 whitespace-delimited words).
 *
 * WHY NOT REQUIRE PUNCTUATION: real user content is frequently punctuation-free
 * (a run-on journal line with no period), so requiring sentence punctuation
 * would let such content leak. Length + word count alone distinguishes prose
 * from a short technical string without depending on the user punctuating.
 *
 * KNOWN LIMITATION (load-bearing privacy decision — do not "optimize" away):
 * SHORT content below the length/word floors under an off-list key will NOT be
 * caught here. That is the deliberate trade-off to avoid over-redacting short
 * technical error strings. `KNOWN_CONTENT_KEYS` is therefore the PRIMARY net
 * and MUST be extended whenever a new content field is introduced; this
 * heuristic is a secondary safety net, not a replacement for it. Conversely, a
 * long technical string (a verbose error) may be over-redacted — that is the
 * privacy-safe direction to err.
 */
export function looksLikeFreeText(value: string): boolean {
  if (typeof value !== 'string') return false
  if (value.length < FREE_TEXT_MIN_LENGTH) return false
  const words = value.trim().split(/\s+/)
  return words.length >= FREE_TEXT_MIN_WORDS
}
