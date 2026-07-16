/**
 * eventAllowlist.test.ts — focused unit tests for the SDK-free pure core of the
 * product-analytics allowlist, mirroring the `redactor.test.ts` /
 * `redactor.e2e.test.ts` split (a lean pure-function unit test alongside the
 * broader end-to-end spec).
 *
 * These assert the invariants three consumers depend on — `captureEvent`, the
 * CI lint, and the server-side emitters — without loading any SDK. The
 * content-key assertion is the executable enforcement of NFR19 on the analytics
 * surface (the analog of `redactor.test.ts` for crash telemetry): it fails the
 * instant anyone adds a content-shaped key to an event's permitted props.
 */

import { describe, expect, it } from 'vitest'
import { EVENT_ALLOWLIST, validateEventProps, getWordCountBucket } from '../eventAllowlist'
import { isContentKey } from '../contentKeys'

describe('validateEventProps — the shared pure validation core', () => {
  it('strips keys not permitted for the event while preserving allowed keys', () => {
    const { sanitizedProps, strippedKeys } = validateEventProps('flow_started', {
      user_id: 'u1',
      tier: 'free',
      rogue: 'nope',
    })

    expect(sanitizedProps).toEqual({ user_id: 'u1', tier: 'free' })
    expect(strippedKeys).toContain('rogue')
  })

  it('reports documented-but-omitted keys as missing', () => {
    const { missingKeys } = validateEventProps('flow_completed', { user_id: 'u1' })
    expect(missingKeys).toEqual(expect.arrayContaining(['tier', 'word_count_bucket']))
  })

  it('yields empty sanitized props (and never throws) for an unknown event', () => {
    expect(() => validateEventProps('not_a_real_event', { x: 1 })).not.toThrow()
    expect(validateEventProps('not_a_real_event', { x: 1 }).sanitizedProps).toEqual({})
  })

  it('tolerates missing/undefined props without throwing', () => {
    expect(() => validateEventProps('flow_started')).not.toThrow()
    expect(validateEventProps('flow_started').sanitizedProps).toEqual({})
  })
})

describe('EVENT_ALLOWLIST — content-key denylist is upheld on the map itself (NFR19)', () => {
  it('no event permits a prop key that isContentKey() matches', () => {
    const offenders: Array<{ event: string; key: string }> = []
    for (const [event, entry] of Object.entries(EVENT_ALLOWLIST)) {
      for (const key of entry.props) {
        if (isContentKey(key)) offenders.push({ event, key })
      }
    }
    expect(offenders).toEqual([])
  })

  it('flow_completed carries only the bucketed count, never a raw word count', () => {
    const props = EVENT_ALLOWLIST.flow_completed.props as readonly string[]
    expect(props).toContain('word_count_bucket')
    expect(props).not.toContain('word_count')
    expect(props).not.toContain('wordCount')
  })
})

describe('getWordCountBucket — lower-inclusive boundaries, never a raw number', () => {
  const cases: Array<[number, string]> = [
    [0, '<100'],
    [99, '<100'],
    [100, '100-499'],
    [499, '100-499'],
    [500, '500-999'],
    [999, '500-999'],
    [1000, '1000+'],
    [1001, '1000+'],
  ]
  it.each(cases)('maps %i → %s', (count, bucket) => {
    expect(getWordCountBucket(count)).toBe(bucket)
  })

  it('always returns one of the four bucket strings', () => {
    const buckets = new Set(['<100', '100-499', '500-999', '1000+'])
    for (const n of [0, 7, 250, 750, 5000]) {
      const b = getWordCountBucket(n)
      expect(typeof b).toBe('string')
      expect(buckets.has(b)).toBe(true)
    }
  })
})
