/**
 * eventAllowlist.e2e.test.ts — TDD RED-PHASE E2E spec for the SDK-free
 * event allowlist that is the single source of truth for every PostHog
 * event the product captures.
 *
 * This is the closest thing to an "end-to-end workflow" this module has:
 * there is no UI here, so the workflow under test is the actual contract
 * three different consumers rely on — `captureEvent` (this story),
 * `scripts/lint-posthog-events.mjs` (this story), and the server-side
 * emitters in Stories 9.4/9.6 — all reading the SAME exported
 * `EVENT_ALLOWLIST` map and the SAME `validateEventProps` pure function.
 * This spec exercises those real exports directly, plus the real
 * `isContentKey` from the existing (already-shipped) `contentKeys.ts`
 * module — no mocking is needed because this module is required by the
 * story to be dependency-free.
 *
 * NAMING ASSUMPTION (documented per this repo's TDD convention of
 * committing to a concrete contract for the dev-story phase to implement
 * against): `validateEventProps(event, props)` is assumed to return
 * `{ sanitizedProps, strippedKeys, missingKeys }`. The word-count bucket
 * helper (design notes: "colocated with the allowlist or in a small
 * buckets.ts") is assumed to be exported from THIS module as
 * `getWordCountBucket(count)`. If the implementation lands under different
 * names, update these imports to match — the behavioral assertions below
 * are what matters.
 *
 * RED PHASE: `packages/app/utils/telemetry/eventAllowlist.ts` does not
 * exist yet. Every test below MUST fail (module-not-found) until this
 * story is implemented. Do not pre-create stub source files to make these
 * pass.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isContentKey } from '../contentKeys'

const MODULE_PATH = path.resolve(import.meta.dirname, '../eventAllowlist.ts')

// The exact initial event → prop-key list from the spec. Order-independent
// membership is what's asserted (extra events are fine — "extensible").
const EXPECTED_EVENTS: Record<string, string[]> = {
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

describe('eventAllowlist.ts — is dependency-free (safe to import from the CI lint script + pure Vitest)', () => {
  it('does not import posthog-js or posthog-react-native', () => {
    const source = readFileSync(MODULE_PATH, 'utf-8')
    expect(source).not.toMatch(/from\s+['"]posthog-js['"]/)
    expect(source).not.toMatch(/from\s+['"]posthog-react-native['"]/)
  })
})

describe('EVENT_ALLOWLIST — the v2 success-metric + product event list is present verbatim', () => {
  it('every documented event exists with exactly its documented prop keys', async () => {
    const { EVENT_ALLOWLIST } = await import('../eventAllowlist')

    for (const [event, props] of Object.entries(EXPECTED_EVENTS)) {
      const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event]
      expect(entry, `expected EVENT_ALLOWLIST to contain "${event}"`).toBeTruthy()
      // Non-null asserted: the toBeTruthy() above guarantees presence; this
      // satisfies noUncheckedIndexedAccess on the Record index access.
      expect(new Set(entry!.props)).toEqual(new Set(props))
    }
  })

  it('every entry has a non-empty human-readable description', async () => {
    const { EVENT_ALLOWLIST } = await import('../eventAllowlist')

    for (const event of Object.keys(EXPECTED_EVENTS)) {
      const entry = (EVENT_ALLOWLIST as Record<string, { description?: string }>)[event]
      expect(typeof entry?.description).toBe('string')
      expect((entry?.description ?? '').length).toBeGreaterThan(0)
    }
  })

  it('flow_completed never allows a raw word_count prop — only the bucketed word_count_bucket', async () => {
    const { EVENT_ALLOWLIST } = await import('../eventAllowlist')
    const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[
      'flow_completed'
    ]
    expect(entry?.props).not.toContain('word_count')
    expect(entry?.props).not.toContain('wordCount')
    expect(entry?.props).toContain('word_count_bucket')
  })
})

describe('EVENT_ALLOWLIST — the content-key denylist is enforced on the map itself (executable twin of the CI lint check)', () => {
  it('no event in EVENT_ALLOWLIST has a prop key that isContentKey() matches', async () => {
    const { EVENT_ALLOWLIST } = await import('../eventAllowlist')
    const offenders: Array<{ event: string; key: string }> = []

    for (const [event, entry] of Object.entries(
      EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>
    )) {
      for (const key of entry.props) {
        if (isContentKey(key)) offenders.push({ event, key })
      }
    }

    expect(offenders).toEqual([])
  })
})

describe('validateEventProps — pure validation shared by captureEvent, the CI lint, and tests', () => {
  it('strips a prop key not documented for the event while preserving allowed keys', async () => {
    const { validateEventProps } = await import('../eventAllowlist')

    const result = validateEventProps('flow_started', {
      user_id: 'user-1',
      tier: 'free',
      unexpectedKey: 'should be stripped',
    } as Record<string, unknown>)

    expect(result.sanitizedProps).toEqual({ user_id: 'user-1', tier: 'free' })
    expect(result.strippedKeys).toContain('unexpectedKey')
    expect(result.sanitizedProps).not.toHaveProperty('unexpectedKey')
  })

  it('reports a documented key as missing when the caller omits it', async () => {
    const { validateEventProps } = await import('../eventAllowlist')

    const result = validateEventProps('flow_started', { user_id: 'user-1' } as Record<
      string,
      unknown
    >)

    expect(result.missingKeys).toContain('tier')
  })

  it('an event name absent from the allowlist yields no sanitized props and never throws', async () => {
    const { validateEventProps } = await import('../eventAllowlist')

    expect(() =>
      validateEventProps('totally_unheard_of_event', { anything: 'here' } as Record<
        string,
        unknown
      >)
    ).not.toThrow()

    const result = validateEventProps('totally_unheard_of_event', {
      anything: 'here',
    } as Record<string, unknown>)
    expect(result.sanitizedProps).toEqual({})
  })
})

describe('getWordCountBucket — pure mapping of a raw word count to the emitted bucket', () => {
  it.each([
    [0, '<100'],
    [1, '<100'],
    [99, '<100'],
    [100, '100-499'],
    [499, '100-499'],
    [500, '500-999'],
    [999, '500-999'],
    [1000, '1000+'],
    [1001, '1000+'],
  ])('maps %i words to bucket %s', async (count, expectedBucket) => {
    const { getWordCountBucket } = await import('../eventAllowlist')
    expect(getWordCountBucket(count)).toBe(expectedBucket)
  })

  it('never returns the raw numeric count — always one of the four bucket strings', async () => {
    const { getWordCountBucket } = await import('../eventAllowlist')
    const buckets = ['<100', '100-499', '500-999', '1000+']
    for (const count of [0, 42, 100, 501, 1500]) {
      const bucket = getWordCountBucket(count)
      expect(typeof bucket).toBe('string')
      expect(buckets).toContain(bucket)
    }
  })
})
