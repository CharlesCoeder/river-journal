// contentKeys.ts — the server-side (Deno/Edge) single source of truth for
// object keys whose VALUES must never reach a log line or an error response,
// plus the free-text value heuristic that catches user prose hiding
// under an unenumerated key.
//
// CROSS-RUNTIME SYNC (keep these aligned by hand — they are NOT one import):
//  - This is a hand-maintained MIRROR of
//    `packages/app/utils/telemetry/contentKeys.ts`. Edge Functions run in a
//    separate Deno runtime/bundle and CANNOT import from `packages/app`, so the
//    5 client BASE keys (`body`, `content`, `flowContent`, `postBody`, `note`)
//    are duplicated here verbatim and must stay byte-identical to the client
//    list. Add a base content key in one place → add it in the other.
//  - This server file ADDITIONALLY owns server-only content keys that never
//    appear on the client (`reason`, `reason_code`, `title`, `raw_receipt`,
//    `receipt`) — moderation free-text reasons and billing receipt payloads.
//    Those live only here; do not push them into the client mirror.
//
// EXTENDING THIS LIST
//  Whenever a new server-side free-text field is introduced, add its object key
//  here. The `looksLikeFreeText` heuristic catches long prose even under an
//  unenumerated key, but SHORT content (a one-word note) below the length
//  threshold is only caught by an exact key match — so this list remains the
//  primary guarantee.

// The client's 5 base keys (byte-identical to the client mirror) PLUS the 5
// server-only keys. Dropping any of the 10 would silently re-open a leak the
// existing logger tests already pin.
export const KNOWN_CONTENT_KEYS = [
  // --- client base keys (must stay aligned with the client mirror) ---
  'body',
  'content',
  'flowContent',
  'postBody',
  'note',
  // --- server-only keys (owned here, not on the client) ---
  'reason',
  'reason_code',
  'title',
  'raw_receipt',
  'receipt',
] as const

/** Lowercased set for O(1) case-insensitive membership checks. */
const CONTENT_KEY_SET = new Set<string>(KNOWN_CONTENT_KEYS.map((key) => key.toLowerCase()))

/**
 * Case-insensitive membership test against `KNOWN_CONTENT_KEYS`.
 * `Body`, `POSTBODY`, `Reason`, `REASON_CODE` all return true — closing the
 * casing-rename escape from an exact-match denylist.
 */
export function isContentKey(key: string): boolean {
  return CONTENT_KEY_SET.has(key.toLowerCase())
}

/**
 * Minimum character length before a string is even considered for the free-text
 * net. Deliberately keeps genuine error messages and stack frames (short and
 * technical) below the bar so they are preserved for debugging.
 * Mirrors the client threshold exactly.
 */
const FREE_TEXT_MIN_LENGTH = 60

/**
 * Minimum word count. Prose is many-worded; a technical token or short error
 * string is not. Mirrors the client threshold exactly.
 */
const FREE_TEXT_MIN_WORDS = 6

/**
 * Raw-length fallback. A string this long is treated as free text regardless of
 * word count, so space-less prose (CJK/Thai and other non-whitespace scripts)
 * that splits into a single "word" cannot evade the many-word primary check.
 * Set safely above the longest technical token we want to preserve (a 64-char
 * hex hash), so ids/urls/error codes still pass through. Mirrors the client
 * threshold exactly.
 */
const FREE_TEXT_FALLBACK_LENGTH = 120

/**
 * Heuristic: does this string look like user-supplied prose rather than a
 * technical error message? Catches long, multi-word content placed under an
 * OFF-LIST key (e.g. `userNote`, `draftText`) so it cannot slip through just
 * because the key was not enumerated.
 *
 * Flags a string when EITHER holds:
 *  - it is long (>= 60 chars) AND many-worded (>= 6 whitespace-delimited
 *    words) — the sentence-shaped primary check; OR
 *  - it is very long (>= 120 chars) regardless of word count — the raw-length
 *    fallback that catches space-less prose (CJK/Thai/etc.) which would
 *    otherwise split into a single "word" and evade the primary check.
 *
 * Punctuation is intentionally not required (a run-on journal line with no
 * period is still user content). SHORT content under an off-list key is NOT
 * caught here — that is the deliberate trade-off to avoid over-redacting short
 * technical strings, which is why `KNOWN_CONTENT_KEYS` remains the primary net.
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
