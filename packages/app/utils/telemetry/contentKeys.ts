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
 *    copy is intentionally synchronized, not shared. These 5 BASE keys must
 *    stay byte-identical in both files: if you add a base content key here, add
 *    it there too. The server file ADDITIONALLY owns server-only content keys
 *    (moderation reasons, billing receipt payloads) that never appear on the
 *    client — those live only in the server mirror, not here.
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
 * Raw-length fallback (kept byte-identical to the server mirror). A string this
 * long is treated as free text regardless of word count, so space-less prose
 * (CJK/Thai and other non-whitespace scripts) that splits into a single "word"
 * cannot evade the many-word primary check. Set safely above the longest
 * technical token we want to preserve (a 64-char hex hash), so ids/urls/error
 * codes still pass through.
 */
const FREE_TEXT_FALLBACK_LENGTH = 120

/**
 * Heuristic: does this string look like user-supplied prose (a journal
 * sentence, a Collective post) rather than a technical error message?
 *
 * INTENT: catch long, multi-word, sentence-shaped content that has been placed
 * under an OFF-LIST key (e.g. `userNote`, `draftText`) so it cannot slip
 * through just because the key was not enumerated in `KNOWN_CONTENT_KEYS`.
 *
 * We flag a string when EITHER holds:
 *  - it is long (>= 60 chars) AND many-worded (>= 6 whitespace-delimited
 *    words) — the sentence-shaped primary check; OR
 *  - it is very long (>= 120 chars) regardless of word count — the raw-length
 *    fallback that catches space-less prose (CJK/Thai/etc.) which would
 *    otherwise collapse to a single "word" and slip past the primary check.
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
  const trimmed = value.trim()
  // Raw-length fallback: very long strings are user content regardless of how
  // many whitespace-delimited "words" they contain (space-less scripts leak
  // otherwise).
  if (trimmed.length >= FREE_TEXT_FALLBACK_LENGTH) return true
  if (trimmed.length < FREE_TEXT_MIN_LENGTH) return false
  const words = trimmed.split(/\s+/)
  return words.length >= FREE_TEXT_MIN_WORDS
}
