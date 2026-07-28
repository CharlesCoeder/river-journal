// Deno unit tests for the structured JSON logger's content redaction.
//
// Run locally with: deno test supabase/functions/
//
// Contract this test file pins down (the envelope logging.ts must satisfy):
//   - logInfo(event, fields) / logError(event, fields) emit a single JSON
//     line via console.log/console.error shaped as `{ event, fields, ... }`
//     (additional envelope keys such as a level/timestamp are fine; this
//     suite only asserts the `event` and `fields` keys).
//   - Every KNOWN_CONTENT_KEYS entry (body, content, flowContent, postBody,
//     note, reason, raw_receipt, receipt) is stripped from `fields` before it
//     is serialized -- INCLUDING when the key appears nested inside another
//     object (e.g. `fields.metadata.note`), not only at the top level. A
//     top-level-only strip would leak nested free text and must fail this
//     suite.
//   - Fields outside the denylist (action_type, user_id, target_post_id,
//     kind, duration_days, provider, ...) pass through unchanged, at any
//     depth.
//
// Red phase (pre-existing suite): `./logging.ts` does not exist yet, so
// every test in this file fails at import resolution before a single
// assertion runs.
// Red phase (raw_receipt/receipt additions below): logging.ts DOES exist by
// the time these run in an already-implemented repo, but KNOWN_CONTENT_KEYS
// does not yet include 'raw_receipt'/'receipt' -- so these two new cases
// fail on a genuine assertion (the leaked marker survives redaction), not on
// import resolution, until the denylist is extended.

import { assert, assertEquals } from 'jsr:@std/assert@1'
import { logError, logInfo, redact } from './logging.ts'

function captureConsole(method: 'log' | 'error', fn: () => void): string {
  const original = console[method]
  let captured = ''
  // deno-lint-ignore no-explicit-any
  console[method] = ((...args: any[]) => {
    captured = String(args[0] ?? '')
  }) as typeof console.log
  try {
    fn()
  } finally {
    console[method] = original
  }
  return captured
}

Deno.test('logInfo redacts every KNOWN_CONTENT_KEYS field at the top level', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      body: 'leaked body',
      content: 'leaked content',
      flowContent: 'leaked flow content',
      postBody: 'leaked post body',
      note: 'leaked private note',
      reason: 'leaked free-text reason',
      action_type: 'remove_post',
    }))

  const parsed = JSON.parse(line)
  assertEquals(parsed.event, 'moderation.notify')
  assertEquals(parsed.fields.body, undefined)
  assertEquals(parsed.fields.content, undefined)
  assertEquals(parsed.fields.flowContent, undefined)
  assertEquals(parsed.fields.postBody, undefined)
  assertEquals(parsed.fields.note, undefined)
  assertEquals(parsed.fields.reason, undefined)
  assertEquals(parsed.fields.action_type, 'remove_post')
})

Deno.test('logInfo recurses into nested objects: a content key inside metadata is also dropped', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      metadata: { kind: 'post_react', duration_days: 3, note: 'nested leaked note' },
    }))

  const raw = line
  assertEquals(raw.includes('nested leaked note'), false)
  const parsed = JSON.parse(line)
  // The raw metadata object must never be logged verbatim -- kind/duration_days
  // are safe and may pass through (flat or nested), but a content key
  // anywhere inside it must not survive serialization.
  assertEquals(JSON.stringify(parsed.fields).includes('"note"'), false)
})

Deno.test('logInfo drops a folded free-text reason even when nested inside another object', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      details: { reason: 'folded free text riding inside a nested object' },
    }))

  assertEquals(line.includes('folded free text riding inside a nested object'), false)
})

Deno.test('logInfo drops a content key nested two levels deep', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      metadata: { inner: { note: 'double-nested leak' } },
    }))

  assertEquals(line.includes('double-nested leak'), false)
})

Deno.test('logError applies the same redaction as logInfo', () => {
  const line = captureConsole('error', () =>
    logError('moderation.notify.error', {
      note: 'leaked note',
      reason: 'leaked reason',
      action_type: 'remove_post',
    }))

  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.note, undefined)
  assertEquals(parsed.fields.reason, undefined)
  assertEquals(parsed.fields.action_type, 'remove_post')
})

Deno.test('logInfo redacts a raw_receipt field at the top level (billing receipt content must never reach a log line)', () => {
  const line = captureConsole('log', () =>
    logInfo('subscription.receipt.validate', {
      provider: 'stripe',
      raw_receipt: 'leaked receipt payload',
    }))

  assertEquals(line.includes('leaked receipt payload'), false)
  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.raw_receipt, undefined)
  assertEquals(parsed.fields.provider, 'stripe')
})

Deno.test('logInfo redacts a receipt field nested inside another object', () => {
  const line = captureConsole('log', () =>
    logInfo('subscription.receipt.validate', {
      provider: 'apple_iap',
      details: { receipt: 'leaked nested receipt token' },
    }))

  assertEquals(line.includes('leaked nested receipt token'), false)
  const parsed = JSON.parse(line)
  assertEquals(JSON.stringify(parsed.fields).includes('"receipt"'), false)
})

Deno.test('logInfo redacts a free-text reason renamed to reason_code, closing the key-rename escape from the denylist', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      reason_code: 'leaked free-text reason riding under a renamed key',
    }))

  assertEquals(line.includes('leaked free-text reason riding under a renamed key'), false)
  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.reason_code, undefined)
})

Deno.test('redact caps recursion depth instead of throwing on a pathologically deep structure', () => {
  // Build a chain deeper than MAX_DEPTH (8).
  let deepest: Record<string, unknown> = { note: 'buried leak' }
  for (let i = 0; i < 20; i++) {
    deepest = { nested: deepest }
  }
  const redacted = redact({ action_type: 'suspend_user', chain: deepest })
  // Must not throw (the test itself would fail on an uncaught RangeError) and
  // must not leak the deeply-buried content key's value.
  assertEquals(JSON.stringify(redacted).includes('buried leak'), false)
})

Deno.test('redact does not infinite-loop on a circular reference', () => {
  // deno-lint-ignore no-explicit-any
  const circular: any = { action_type: 'suspend_user' }
  circular.self = circular
  // Must return rather than recurse forever; JSON.stringify would itself
  // throw on a true cycle, so a successful stringify proves the cycle was
  // broken by the redactor.
  const redacted = redact(circular)
  const raw = JSON.stringify(redacted)
  assertEquals(typeof raw, 'string')
})

Deno.test('logInfo passes safe flat fields through unchanged (kind/duration_days as top-level, not nested inside metadata)', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      kind: 'post_react',
      duration_days: 3,
      target_post_id: 'post-123',
      user_id: 'user-abc',
    }))

  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.kind, 'post_react')
  assertEquals(parsed.fields.duration_days, 3)
  assertEquals(parsed.fields.target_post_id, 'post-123')
  assertEquals(parsed.fields.user_id, 'user-abc')
})

// ── Hardening additions below: case-insensitive key match + free-text value
// net (closing the casing-rename escape and the off-list-key escape). Red
// phase: the current DENYLIST.has(key) is an exact-match Set lookup with no
// value-level net, so every case below fails on a genuine assertion (the
// leaked marker survives redaction) until redact() is hardened to
// isContentKey()'s case-insensitive matching and gains the looksLikeFreeText
// value net.

Deno.test('logInfo redacts denylisted keys case-insensitively, closing the casing-rename escape (Body, Reason)', () => {
  const line = captureConsole('log', () =>
    logInfo('subscription.receipt.validate', {
      Body: 'leaked body via a case-variant key',
      Reason: 'leaked reason via a case-variant key',
      action_type: 'validate_receipt',
    }))

  assertEquals(line.includes('leaked body via a case-variant key'), false)
  assertEquals(line.includes('leaked reason via a case-variant key'), false)
  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.Body, undefined)
  assertEquals(parsed.fields.Reason, undefined)
  assertEquals(parsed.fields.action_type, 'validate_receipt')
})

Deno.test('logInfo redacts an ALL-CAPS-variant denylisted key nested inside another object', () => {
  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      details: { REASON: 'leaked reason via an all-caps nested key' },
    }))

  assertEquals(line.includes('leaked reason via an all-caps nested key'), false)
})

Deno.test('logInfo redacts a free-text-shaped value riding under an OFF-list key (the looksLikeFreeText value net)', () => {
  const freeText =
    'This is a fairly long free-text note that a user might type into a draft field without anyone renaming the key to something on the denylist.'
  assert(freeText.length >= 60 && freeText.trim().split(/\s+/).length >= 6)

  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      userNote: freeText,
    }))

  assertEquals(line.includes(freeText), false)
  const parsed = JSON.parse(line)
  assertEquals(typeof parsed.fields.userNote, 'string')
  // The key survives (it is not denylisted) but the VALUE must be replaced
  // with a redacted marker, never the original prose.
  assert(parsed.fields.userNote.includes('redacted'))
})

Deno.test('the free-text value net also catches a long prose string nested inside another object under an off-list key', () => {
  const freeText =
    'Another sufficiently long piece of free-text prose that a user typed, sitting inside a nested object under an off-list key so it has no exact-match key to hide behind.'
  assert(freeText.length >= 60 && freeText.trim().split(/\s+/).length >= 6)

  const line = captureConsole('log', () =>
    logInfo('moderation.notify', {
      action_type: 'suspend_user',
      metadata: { draftText: freeText },
    }))

  assertEquals(line.includes(freeText), false)
})

Deno.test('logInfo preserves a short technical string under an off-list key (no over-redaction) alongside safe metadata', () => {
  const line = captureConsole('log', () =>
    logInfo('subscription.receipt.validate', {
      errCode: 'E_TIMEOUT',
      provider: 'stripe',
    }))

  const parsed = JSON.parse(line)
  assertEquals(parsed.fields.errCode, 'E_TIMEOUT')
  assertEquals(parsed.fields.provider, 'stripe')
})
