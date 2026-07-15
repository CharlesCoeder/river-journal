/**
 * redactor.test.ts — focused unit tests for the telemetry redactor internals.
 *
 * This is the operational enforcement of the "telemetry excludes user content"
 * invariant on the client, analogous to how the streak module's test
 * operationalizes its own privacy/behavior invariant. Any real content field
 * that could leak should be added here as a new regression case.
 *
 * The broader, event-shaped acceptance sweep lives in
 * `redactor.e2e.test.ts`; this file pins the unit-level contracts of
 * `redactEvent`, `isContentKey`, and `looksLikeFreeText` directly.
 */

import { describe, expect, it } from 'vitest'
import { redactEvent, REDACTED } from '../redactor'
import { KNOWN_CONTENT_KEYS, isContentKey, looksLikeFreeText } from '../contentKeys'

/** Deep recursive scan for a literal substring anywhere in the payload. */
function containsLeak(value: unknown, needle: string): boolean {
  return JSON.stringify(value)?.includes(needle) ?? false
}

const LONG_PROSE =
  'Today I finally told my therapist about what happened last spring, and it ' +
  'felt like a weight lifted off my chest that I did not know I was carrying.'

describe('isContentKey — case-insensitive membership', () => {
  it('matches every canonical known key', () => {
    for (const key of KNOWN_CONTENT_KEYS) {
      expect(isContentKey(key)).toBe(true)
    }
  })

  it('matches casing variants', () => {
    expect(isContentKey('Body')).toBe(true)
    expect(isContentKey('POSTBODY')).toBe(true)
    expect(isContentKey('FlowContent')).toBe(true)
  })

  it('does not match unrelated keys', () => {
    expect(isContentKey('id')).toBe(false)
    expect(isContentKey('url')).toBe(false)
    expect(isContentKey('timestamp')).toBe(false)
  })
})

describe('looksLikeFreeText — prose vs technical strings', () => {
  it('flags long, many-worded prose', () => {
    expect(looksLikeFreeText(LONG_PROSE)).toBe(true)
  })

  it('flags punctuation-free run-on prose (privacy: user need not punctuate)', () => {
    expect(
      looksLikeFreeText('I keep thinking about the argument we had and I do not know how to fix it')
    ).toBe(true)
  })

  it('preserves a short technical error message', () => {
    expect(looksLikeFreeText('TypeError: x is undefined')).toBe(false)
  })

  it('preserves a short multi-word phrase below the length floor', () => {
    expect(looksLikeFreeText('Failed to persist flow')).toBe(false)
  })

  it('preserves a long single token (no whitespace → not prose)', () => {
    expect(looksLikeFreeText('a'.repeat(200))).toBe(false)
  })
})

describe('redactEvent — known-key net redacts regardless of value type', () => {
  it('redacts a string under a known key', () => {
    const result = redactEvent({ extra: { body: 'secret journal line' } }) as any
    expect(result.extra.body).toBe(REDACTED)
  })

  it('redacts a number under a known key', () => {
    const result = redactEvent({ extra: { body: 42 } }) as any
    expect(result.extra.body).toBe(REDACTED)
  })

  it('redacts a nested object under a known key', () => {
    const result = redactEvent({ extra: { content: { deep: 'secret' } } })
    expect(containsLeak(result, 'secret')).toBe(false)
  })
})

describe('redactEvent — scrubs standard Sentry fields, not just a fixed allowlist', () => {
  it('redacts content under a known key in request.data (e.g. a POST body)', () => {
    const result = redactEvent({
      request: {
        url: 'https://example.com/api/flow',
        data: { body: 'the exact journal text the user submitted' },
      },
    }) as any
    expect(containsLeak(result, 'the exact journal text the user submitted')).toBe(false)
    // Non-content request metadata survives for debugging.
    expect(result.request.url).toBe('https://example.com/api/flow')
  })

  it('redacts content under a known key in tags', () => {
    const result = redactEvent({ tags: { flowContent: 'secret snippet stashed on a tag' } })
    expect(containsLeak(result, 'secret snippet stashed on a tag')).toBe(false)
  })

  it('redacts free-text prose in the transaction name while preserving a short route name', () => {
    expect(containsLeak(redactEvent({ transaction: LONG_PROSE }), 'told my therapist')).toBe(false)
    expect((redactEvent({ transaction: '/journal/[id]' }) as any).transaction).toBe('/journal/[id]')
  })

  it('redacts free-text prose in spans[].description', () => {
    const result = redactEvent({ spans: [{ op: 'db.query', description: LONG_PROSE }] })
    expect(containsLeak(result, 'told my therapist')).toBe(false)
  })

  it('redacts content in stacktrace frame local vars', () => {
    const result = redactEvent({
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: {
              frames: [{ function: 'saveFlow', vars: { body: 'local var journal text' } }],
            },
          },
        ],
      },
    })
    expect(containsLeak(result, 'local var journal text')).toBe(false)
  })
})

describe('redactEvent — non-content fields are preserved', () => {
  it('leaves a Supabase user id and a url untouched', () => {
    const event = {
      user: { id: 'user-abc-123' },
      breadcrumbs: [{ category: 'http', data: { url: 'https://example.com' } }],
    }
    const result = redactEvent(event) as any
    expect(result.user.id).toBe('user-abc-123')
    expect(result.breadcrumbs[0].data.url).toBe('https://example.com')
  })
})

describe('redactEvent — robustness contracts', () => {
  it('is idempotent', () => {
    const once = redactEvent({ extra: { body: 'x'.repeat(80) + ' words here now' } })
    const twice = redactEvent(once)
    expect(twice).toEqual(once)
  })

  it('never throws on malformed input', () => {
    expect(() => redactEvent(undefined as any)).not.toThrow()
    expect(() => redactEvent(null as any)).not.toThrow()
    expect(() => redactEvent({} as any)).not.toThrow()
    expect(() => redactEvent(5 as any)).not.toThrow()
  })

  it('does not mutate the input event', () => {
    const event = { extra: { body: 'secret original value here in the object' } }
    redactEvent(event)
    expect(event.extra.body).toBe('secret original value here in the object')
  })
})
