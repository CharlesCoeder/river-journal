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

describe('EVENT_ALLOWLIST — the two server-emitted delivery events this story adds', () => {
  it('exposes exactly 17 events (the 15 pre-existing events plus the two new delivery events)', () => {
    expect(Object.keys(EVENT_ALLOWLIST)).toHaveLength(17)
  })

  it('collective_reply_delivered is present with the metadata-only prop schema (recipient_count, sent_count, failed_count) and no user_id', () => {
    const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)
      .collective_reply_delivered
    expect(entry).toBeDefined()
    expect([...entry.props].sort()).toEqual(['failed_count', 'recipient_count', 'sent_count'])
    expect(entry.props).not.toContain('user_id')
  })

  it('moderation_notification_delivered is present with the metadata-only prop schema (action_type, sent_count, failed_count) and no user_id', () => {
    const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)
      .moderation_notification_delivered
    expect(entry).toBeDefined()
    expect([...entry.props].sort()).toEqual(['action_type', 'failed_count', 'sent_count'])
    expect(entry.props).not.toContain('user_id')
  })

  it('neither new event permits a content-shaped prop key (NFR19)', () => {
    const events = ['collective_reply_delivered', 'moderation_notification_delivered'] as const
    const offenders: Array<{ event: string; key: string }> = []
    for (const event of events) {
      const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] } | undefined>)[
        event
      ]
      for (const key of entry?.props ?? []) {
        if (isContentKey(key)) offenders.push({ event, key })
      }
    }
    expect(offenders).toEqual([])
  })

  it('the 15 pre-existing client event shapes are unchanged by this story', () => {
    const preExisting: Record<string, readonly string[]> = {
      flow_started: ['user_id', 'tier'],
      flow_completed: ['user_id', 'tier', 'word_count_bucket'],
      flow_500_crossed: ['user_id', 'tier'],
      streak_unlock_earned: ['user_id', 'tier', 'milestone'],
      collective_post_submitted: ['user_id', 'tier'],
      collective_reaction_toggled: ['user_id', 'tier', 'reaction_kind'],
      collective_report_submitted: ['user_id', 'tier'],
      subscription_purchased: ['user_id', 'provider', 'tier'],
      subscription_cancel_initiated: ['user_id', 'provider', 'tier'],
      subscription_cancel_confirmed: ['user_id', 'provider', 'tier'],
      account_deleted: ['tier'],
      moderation_action_taken: ['action_type', 'anonymized_actor', 'target_type'],
      moderation_suspension_applied: ['kind', 'duration_days', 'anonymized_actor'],
      moderation_queue_depth_sample: ['pending_count', 'oldest_pending_age_seconds'],
      sync_opt_in_snapshot: ['opted_in_count', 'total_count'],
    }
    for (const [event, props] of Object.entries(preExisting)) {
      const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event]
      expect([...entry.props].sort()).toEqual([...props].sort())
    }
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
