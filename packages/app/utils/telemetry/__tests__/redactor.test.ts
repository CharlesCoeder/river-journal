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
import { normalizeUrlToRoutePattern, redactEvent, REDACTED } from '../redactor'
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

  it('preserves a long single token below the raw-length fallback (no whitespace → not prose)', () => {
    expect(looksLikeFreeText('a'.repeat(100))).toBe(false)
  })

  it('preserves a 64-char hex hash (a technical token below the raw-length fallback)', () => {
    expect(looksLikeFreeText('deadbeef'.repeat(8))).toBe(false)
  })

  it('flags space-less prose past the raw-length fallback (CJK collapses to one "word")', () => {
    // A ~130-codepoint run of CJK with no whitespace splits into a single
    // "word" and would evade the >= 6-word primary check, so the raw-length
    // fallback must catch it.
    const cjk = '今日はセラピストに去年の春の出来事を打ち明けた気持ちが軽くなった'.repeat(4)
    expect(cjk.split(/\s+/).length).toBe(1)
    expect(cjk.length).toBeGreaterThanOrEqual(120)
    expect(looksLikeFreeText(cjk)).toBe(true)
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

  it('redacts space-less CJK prose under an off-list key via the raw-length fallback', () => {
    const cjk = '今日はセラピストに去年の春の出来事を打ち明けた気持ちが軽くなった'.repeat(4)
    const result = redactEvent({ extra: { draftText: cjk } }) as any
    expect(containsLeak(result, cjk)).toBe(false)
    expect(result.extra.draftText).toBe(REDACTED)
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

describe('normalizeUrlToRoutePattern — id segments become the route pattern', () => {
  it('replaces a UUID path segment and drops the query string', () => {
    expect(
      normalizeUrlToRoutePattern(
        'https://example.com/collective/thread/0b8f4d0e-2f6a-4a4e-9c1d-3a7b8c9d0e1f?ref=push#top'
      )
    ).toBe('https://example.com/collective/thread/[id]')
  })

  it('replaces numeric and long-hex segments while keeping route names', () => {
    expect(normalizeUrlToRoutePattern('https://example.com/day-view/20260831')).toBe(
      'https://example.com/day-view/[id]'
    )
    expect(normalizeUrlToRoutePattern('https://example.com/journal/' + 'deadbeef'.repeat(4))).toBe(
      'https://example.com/journal/[id]'
    )
  })

  it('normalizes relative URLs without inventing an origin', () => {
    expect(
      normalizeUrlToRoutePattern('/collective/thread/0b8f4d0e-2f6a-4a4e-9c1d-3a7b8c9d0e1f')
    ).toBe('/collective/thread/[id]')
  })

  it('leaves an id-free URL untouched apart from dropping the query', () => {
    expect(normalizeUrlToRoutePattern('https://example.com/settings')).toBe(
      'https://example.com/settings'
    )
  })

  it('returns an unparseable input unchanged (never throws)', () => {
    expect(normalizeUrlToRoutePattern('not a url at all')).toBe('not a url at all')
  })
})

describe('redactEvent — request.url is normalized to its route pattern', () => {
  it('strips the resource id from request.url so it cannot pair with user.id', () => {
    const uuid = '0b8f4d0e-2f6a-4a4e-9c1d-3a7b8c9d0e1f'
    const result = redactEvent({
      user: { id: 'user-abc-123' },
      request: { url: `https://app.example.com/collective/thread/${uuid}?utm_source=x` },
    }) as any
    expect(result.request.url).toBe('https://app.example.com/collective/thread/[id]')
    expect(containsLeak(result, uuid)).toBe(false)
    expect(containsLeak(result, 'utm_source')).toBe(false)
    // The user id itself is still preserved — the pair is what is broken.
    expect(result.user.id).toBe('user-abc-123')
  })

  it('does not rewrite URLs outside request.url (breadcrumb urls stay as-is)', () => {
    const result = redactEvent({
      breadcrumbs: [{ category: 'http', data: { url: 'https://example.com/api/123' } }],
    }) as any
    expect(result.breadcrumbs[0].data.url).toBe('https://example.com/api/123')
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
