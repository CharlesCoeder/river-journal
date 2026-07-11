// Deno unit tests for the structured JSON logger's NFR19 content redaction.
//
// Run locally with: deno test supabase/functions/
//
// Contract this test file pins down (the envelope logging.ts must satisfy):
//   - logInfo(event, fields) / logError(event, fields) emit a single JSON
//     line via console.log/console.error shaped as `{ event, fields, ... }`
//     (additional envelope keys such as a level/timestamp are fine; this
//     suite only asserts the `event` and `fields` keys).
//   - Every KNOWN_CONTENT_KEYS entry (body, content, flowContent, postBody,
//     note, reason) is stripped from `fields` before it is serialized --
//     INCLUDING when the key appears nested inside another object (e.g.
//     `fields.metadata.note`), not only at the top level. A top-level-only
//     strip would leak nested free text and must fail this suite.
//   - Fields outside the denylist (action_type, user_id, target_post_id,
//     kind, duration_days, ...) pass through unchanged, at any depth.
//
// Red phase: `./logging.ts` does not exist yet, so every test in this file
// fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
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
