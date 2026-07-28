/**
 * redactor.e2e.test.ts — TDD RED-PHASE E2E spec for the Sentry `beforeSend`
 * redactor.
 *
 * These tests exercise `redactEvent()` — the pure function that IS the body
 * of `beforeSend` on every platform (web/desktop/mobile share this one
 * module per the design notes "single source of truth" rule) — against
 * realistic, full-shaped synthetic Sentry events. This is the closest thing
 * to an end-to-end user workflow this feature has: there is no UI, so the
 * "workflow" under test is the actual telemetry pipeline —
 * app throws/logs → SDK builds an event → `beforeSend(event)` runs → the
 * scrubbed payload is what would leave the device.
 *
 * RED PHASE: `packages/app/utils/telemetry/redactor.ts` does not exist yet.
 * Every test below MUST fail (module-not-found) until the redactor is
 * implemented. Do not pre-create stub source files to make these pass.
 */

import { describe, expect, it } from 'vitest'
import { redactEvent } from '../redactor'

const REDACTED = '[redacted]'

/** Deep recursive scan for a literal substring anywhere in a JSON-serializable value. */
function containsLeak(value: unknown, needle: string): boolean {
  return JSON.stringify(value)?.includes(needle) ?? false
}

// A long, sentence-shaped, multi-word string that the free-text heuristic
// ("length > ~120 and containing whitespace + sentence punctuation")
// must flag regardless of which key it is stored under.
const LONG_PROSE =
  'Today I finally told my therapist about what happened last spring, and it felt like ' +
  'a weight lifted off my chest that I did not know I was carrying for this long.'

const SHORT_TECHNICAL_MESSAGE = 'TypeError: x is undefined'

describe('redactEvent — regression test proves redaction and fails on leak', () => {
  it('redacts extra.body content: the field is [redacted] or omitted, and the raw string never appears in the serialized payload', () => {
    const event = { extra: { body: 'private flow content' } }
    const result = redactEvent(event)

    const bodyValue = (result as any)?.extra?.body
    expect(bodyValue === REDACTED || bodyValue === undefined).toBe(true)
    expect(containsLeak(result, 'private flow content')).toBe(false)
  })
})

describe('redactEvent — known-key net (case-insensitive, every walked location)', () => {
  const KNOWN_CONTENT_KEYS = ['body', 'content', 'flowContent', 'postBody', 'note']

  it.each(KNOWN_CONTENT_KEYS)('redacts extra.%s at the top level', (key) => {
    const event = { extra: { [key]: 'this is the secret journal content for this key' } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'secret journal content')).toBe(false)
  })

  it('redacts event.contexts values under known keys', () => {
    const event = {
      contexts: {
        custom: { note: 'a private note about today, written in the journal' },
      },
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'private note about today')).toBe(false)
  })

  it('redacts breadcrumb.data under a known key', () => {
    const event = {
      breadcrumbs: [
        { category: 'ui.click', data: { content: 'the user typed this exact journal body text' } },
      ],
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'typed this exact journal body text')).toBe(false)
  })

  it('redacts breadcrumb.message when it is content-shaped free text', () => {
    const event = {
      breadcrumbs: [{ category: 'console', message: LONG_PROSE }],
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('redacts exception.values[].value free text while preserving a short technical message', () => {
    const event = {
      exception: {
        values: [
          { type: 'Error', value: LONG_PROSE },
          { type: 'TypeError', value: SHORT_TECHNICAL_MESSAGE },
        ],
      },
    }
    const result = redactEvent(event) as any
    expect(containsLeak(result, 'told my therapist')).toBe(false)
    expect(result.exception.values[1].value).toBe(SHORT_TECHNICAL_MESSAGE)
  })

  it('case-insensitive match: extra.Body (capitalized) is redacted', () => {
    const event = { extra: { Body: 'secret content under a capitalized key' } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'secret content under a capitalized key')).toBe(false)
  })

  it('case-insensitive match: extra.postBody / extra.flowContent casing variants are redacted', () => {
    const event = {
      extra: {
        PostBody: 'variant-cased postBody secret',
        FlowContent: 'variant-cased flowContent secret',
      },
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'variant-cased postBody secret')).toBe(false)
    expect(containsLeak(result, 'variant-cased flowContent secret')).toBe(false)
  })
})

describe('redactEvent — free-text heuristic net fires independently of the known-key list', () => {
  it('red-team: content under an off-list key (extra.userNote) is redacted by the free-text net', () => {
    const event = { extra: { userNote: LONG_PROSE } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('red-team: content under an off-list key (extra.draftText) is redacted by the free-text net', () => {
    const event = { extra: { draftText: LONG_PROSE } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('a short, technical, non-prose message is preserved (heuristic does not over-redact)', () => {
    const event = { message: SHORT_TECHNICAL_MESSAGE }
    const result = redactEvent(event) as any
    expect(result.message).toBe(SHORT_TECHNICAL_MESSAGE)
  })

  it('a genuinely long free-text event.message is redacted', () => {
    const event = { message: LONG_PROSE }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })
})

describe('redactEvent — red-team: nested/array content cannot slip through unenumerated', () => {
  it('redacts content nested inside an array of objects (extra.items[].content)', () => {
    const event = {
      extra: {
        items: [
          { id: 1, content: 'nested array secret content number one' },
          { id: 2, content: 'nested array secret content number two' },
        ],
      },
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'nested array secret content number one')).toBe(false)
    expect(containsLeak(result, 'nested array secret content number two')).toBe(false)
  })

  it('redacts free-text prose nested arbitrarily deep under unknown keys', () => {
    const event = {
      extra: {
        wrapper: {
          inner: {
            anotherUnknownKey: LONG_PROSE,
          },
        },
      },
    }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })
})

describe('redactEvent — robust against real event shapes (edge-case sweep)', () => {
  it('redacts a non-string content-keyed value: a plain number', () => {
    const event = { extra: { body: 42 } }
    const result = redactEvent(event) as any
    // Numeric content under a known key must not survive verbatim — either
    // replaced with the redacted placeholder or omitted.
    expect(result.extra?.body === REDACTED || result.extra?.body === undefined).toBe(true)
  })

  it('redacts a non-string content-keyed value: a nested object', () => {
    const event = { extra: { body: { nested: 'secret' } } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'secret')).toBe(false)
  })

  it('redacts a non-string content-keyed value: an array of objects', () => {
    const event = { extra: { body: [{ text: 'secret one' }, { text: 'secret two' }] } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'secret one')).toBe(false)
    expect(containsLeak(result, 'secret two')).toBe(false)
  })

  it('handles event.message in structured { message, params } form', () => {
    const event = { message: { message: LONG_PROSE, params: ['a', 'b'] } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('handles a structured message whose params contain content-shaped strings', () => {
    const event = { message: { message: 'template %s', params: [LONG_PROSE] } }
    const result = redactEvent(event)
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('guards against circular references: does not hang or throw, and still redacts reachable content', () => {
    const circular: Record<string, unknown> = { body: 'circular secret content payload' }
    circular.self = circular
    const event = { extra: circular }

    let result: unknown
    expect(() => {
      result = redactEvent(event)
    }).not.toThrow()
    expect(containsLeak(result, 'circular secret content payload')).toBe(false)
  })

  it('is idempotent: redacting an already-redacted event is a no-op (no throw, stable output)', () => {
    const event = { extra: { body: 'secret content redacted twice' } }
    const once = redactEvent(event)
    const twice = redactEvent(once)
    expect(twice).toEqual(once)
  })

  it('never throws on a malformed/partial event: undefined', () => {
    expect(() => redactEvent(undefined as any)).not.toThrow()
  })

  it('never throws on a malformed/partial event: empty object', () => {
    expect(() => redactEvent({})).not.toThrow()
  })

  it('never throws on a malformed/partial event: missing nested levels (breadcrumbs without data)', () => {
    const event = { breadcrumbs: [{ category: 'nav' }] }
    expect(() => redactEvent(event)).not.toThrow()
  })

  it('never throws and still returns a value on a null event', () => {
    let result: unknown
    expect(() => {
      result = redactEvent(null as any)
    }).not.toThrow()
    expect(result).toBeDefined()
  })
})

describe('redactEvent — full workflow: a realistic journal-crash event leaks nothing', () => {
  it('scrubs every content field across extra, contexts, breadcrumbs, exception, and message on one full event', () => {
    // Mirrors what an actual unhandled exception during a journal-entry save
    // might look like once the SDK has assembled it, exercising the full
    // beforeSend pipeline end-to-end in one shot ().
    const secret = 'I keep thinking about the argument we had and I do not know how to fix it'
    const fullEvent = {
      message: 'Failed to persist flow',
      extra: {
        body: secret,
        userNote: secret,
        items: [{ content: secret }],
      },
      contexts: {
        flow: { flowContent: secret },
      },
      breadcrumbs: [
        { category: 'console', message: secret, data: { note: secret } },
        { category: 'http', data: { url: 'https://example.com' } },
      ],
      exception: {
        values: [{ type: 'Error', value: `Save failed: ${secret}` }],
      },
      user: { id: 'user-abc-123' },
    }

    const result = redactEvent(fullEvent)

    expect(containsLeak(result, secret)).toBe(false)
    // Non-content fields survive untouched — this is a redactor, not a
    // full-event scrubber. user.id (Supabase user id, not PII) must remain.
    expect((result as any).user?.id).toBe('user-abc-123')
    expect((result as any).breadcrumbs?.[1]?.data?.url).toBe('https://example.com')
  })
})
