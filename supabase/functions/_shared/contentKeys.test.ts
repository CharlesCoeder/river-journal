// Deno unit tests for supabase/functions/_shared/contentKeys.ts — the
// server-side single source of truth for the content-key denylist and the
// free-text value heuristic. This module is a hand-maintained MIRROR of
// packages/app/utils/telemetry/contentKeys.ts (Edge Functions run in a
// separate Deno runtime/bundle and cannot import from packages/app), so this
// suite pins both the module's own contract AND its alignment with the
// client mirror + with logging.ts's re-export.
//
// Run locally with: deno test supabase/functions/
//
// RED PHASE: `./contentKeys.ts` does not exist yet, so every test in this
// file fails at import resolution before a single assertion runs. The final
// two tests (logging.ts re-export checks) additionally require logging.ts to
// import from contentKeys.ts rather than keep its own inline denylist —
// until that wiring lands, those tests fail on a genuine assertion even in a
// world where contentKeys.ts existed in isolation.

import { assert, assertEquals } from 'jsr:@std/assert@1'
import { isContentKey, KNOWN_CONTENT_KEYS, looksLikeFreeText } from './contentKeys.ts'
import { KNOWN_CONTENT_KEYS as LOGGING_KNOWN_CONTENT_KEYS, redact } from './logging.ts'

// The client's 5 base keys (packages/app/utils/telemetry/contentKeys.ts) —
// these must appear byte-identical in the server mirror.
const CLIENT_BASE_KEYS = ['body', 'content', 'flowContent', 'postBody', 'note']

// The 5 server-only keys already relied upon by logging.test.ts's pre-existing
// assertions — dropping any one of these would silently re-open a
// leak that suite already pins.
const SERVER_ONLY_KEYS = ['reason', 'reason_code', 'title', 'raw_receipt', 'receipt']

Deno.test('KNOWN_CONTENT_KEYS is exactly the 5 client base keys plus the 5 server-only keys — no drop, no drift', () => {
  const expected = new Set([...CLIENT_BASE_KEYS, ...SERVER_ONLY_KEYS])
  assertEquals(new Set(KNOWN_CONTENT_KEYS), expected)
  assertEquals(KNOWN_CONTENT_KEYS.length, expected.size)
})

Deno.test('the 5 client base keys are present, byte-identical (same casing) to the client mirror', () => {
  for (const key of CLIENT_BASE_KEYS) {
    assert(
      (KNOWN_CONTENT_KEYS as readonly string[]).includes(key),
      `expected KNOWN_CONTENT_KEYS to include the client base key '${key}' verbatim`
    )
  }
})

Deno.test('isContentKey is case-insensitive for every denylisted key, including casing-rename variants', () => {
  assert(isContentKey('body'))
  assert(isContentKey('Body'))
  assert(isContentKey('POSTBODY'))
  assert(isContentKey('flowContent'))
  assert(isContentKey('FlowContent'))
  assert(isContentKey('Reason'))
  assert(isContentKey('REASON_CODE'))
  assert(isContentKey('Raw_Receipt'))
  assert(isContentKey('RECEIPT'))
  assert(isContentKey('Title'))
})

Deno.test('isContentKey returns false for safe metadata keys', () => {
  assert(!isContentKey('action_type'))
  assert(!isContentKey('user_id'))
  assert(!isContentKey('duration_days'))
  assert(!isContentKey('target_post_id'))
  assert(!isContentKey('errCode'))
})

Deno.test('looksLikeFreeText requires BOTH >= 60 chars AND >= 6 words (mirrors the client thresholds exactly)', () => {
  // Long but a single "word" (no whitespace) -- must NOT trip the heuristic.
  const longSingleWord = 'x'.repeat(65)
  assert(longSingleWord.length >= 60)
  assert(!looksLikeFreeText(longSingleWord))

  // Many words but under the length floor -- must NOT trip the heuristic.
  const manyWordsButShort = 'one two three four five six seven'
  assert(manyWordsButShort.length < 60)
  assert(!looksLikeFreeText(manyWordsButShort))

  // Both thresholds cleared -- must trip the heuristic.
  const prose = 'This is a sufficiently long piece of free-text prose with plenty of words in it.'
  assert(prose.length >= 60)
  assert(prose.trim().split(/\s+/).length >= 6)
  assert(looksLikeFreeText(prose))
})

Deno.test('looksLikeFreeText does not require punctuation (a punctuation-free run-on still trips the net)', () => {
  const runOn = 'user typed a long run on line with no punctuation at all just words after words'
  assert(runOn.length >= 60)
  assert(runOn.trim().split(/\s+/).length >= 6)
  assert(looksLikeFreeText(runOn))
})

Deno.test('looksLikeFreeText raw-length fallback catches space-less prose that collapses to one "word" (CJK)', () => {
  // A long CJK run has no whitespace, so it splits to a single "word" and would
  // slip past the >= 6-word primary check. The raw-length fallback (>= 120)
  // catches it regardless of word count.
  const cjk = '今日はセラピストに去年の春の出来事を打ち明けた気持ちが軽くなった'.repeat(4)
  assertEquals(cjk.split(/\s+/).length, 1)
  assert(cjk.length >= 120)
  assert(looksLikeFreeText(cjk))
})

Deno.test('looksLikeFreeText preserves a short space-less technical token below the fallback (64-char hex hash)', () => {
  const hexHash = 'deadbeef'.repeat(8) // 64 hex chars, one "word", below the 120 fallback
  assertEquals(hexHash.length, 64)
  assertEquals(hexHash.split(/\s+/).length, 1)
  assert(!looksLikeFreeText(hexHash))
})

Deno.test('logging.ts re-exports the SAME KNOWN_CONTENT_KEYS as contentKeys.ts (single source of truth, no re-inlined duplicate)', () => {
  assertEquals(new Set(LOGGING_KNOWN_CONTENT_KEYS), new Set(KNOWN_CONTENT_KEYS))
})

Deno.test('logging.ts still exports redact as a function (re-export preserved so existing importers keep compiling)', () => {
  assertEquals(typeof redact, 'function')
})
