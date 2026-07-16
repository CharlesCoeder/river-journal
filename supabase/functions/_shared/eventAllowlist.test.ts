// Deno unit tests for the server-side event allowlist mirror.
//
// Run locally with: deno test --allow-env --allow-read supabase/functions/
//
// NOT wired into `yarn vitest` -- supabase/functions/** is excluded from the
// root vitest.config.mts glob (Deno 2 code: URL/npm:/jsr: imports, Deno.*
// globals). This file is `deno test`-only.
//
// Contract pinned down here (per the acceptance criteria's "hand-synced
// MIRROR, byte-comparable" requirement -- this is NOT a re-derivation, it is
// the same shape/behavior as `packages/app/utils/telemetry/eventAllowlist.ts`,
// duplicated by hand into this Deno-importable, dependency-free module):
//   - EVENT_ALLOWLIST: the SAME 17-event map as the client file (the 15
//     pre-existing events UNCHANGED, plus the two new delivery events this
//     story adds: `collective_reply_delivered` (props: recipient_count,
//     sent_count, failed_count) and `moderation_notification_delivered`
//     (props: action_type, sent_count, failed_count)).
//   - validateEventProps(event, props?): ValidatedEventProps -- the identical
//     pure validation core (strips unpermitted keys into `strippedKeys`,
//     reports documented-but-omitted keys in `missingKeys`, and an unknown
//     event yields empty results without throwing).
//   - Every event's permitted prop keys pass isContentKey() = false (the
//     executable NFR19 enforcement on the allowlist itself, mirroring the
//     client file's own content-key test).
//
// The client<->server deep-equality/drift guard (the parity test named in
// the acceptance criteria) lives in Vitest, NOT here -- see
// packages/app/utils/telemetry/__tests__/eventAllowlistServerParity.test.ts.
// Both files are dependency-free and importable from Node, so placing the
// cross-runtime comparison in Vitest (which can `import` this Deno-owned file
// by its literal .ts path) is simpler than re-importing the client file from
// Deno (impossible -- Edge Functions can't reach `packages/app`). This file
// instead pins the server mirror's OWN shape/behavior in isolation.
//
// Red phase: ./eventAllowlist.ts does not exist yet, so every test in this
// file fails at import resolution before a single assertion runs.

import { assertEquals } from 'jsr:@std/assert@1'
import { EVENT_ALLOWLIST, validateEventProps } from './eventAllowlist.ts'
import { isContentKey } from './contentKeys.ts'

// The exact 17-event -> permitted-props contract this mirror must expose.
// Keys/values here are NOT invented for this test file -- they are the 15
// pre-existing client events (unchanged) plus the two new delivery events
// named explicitly in the acceptance criteria.
const EXPECTED_EVENT_PROPS: Record<string, readonly string[]> = {
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
  collective_reply_delivered: ['recipient_count', 'sent_count', 'failed_count'],
  moderation_notification_delivered: ['action_type', 'sent_count', 'failed_count'],
}

Deno.test('EVENT_ALLOWLIST exposes exactly the 17 documented event names, no more, no fewer', () => {
  assertEquals(Object.keys(EVENT_ALLOWLIST).sort(), Object.keys(EXPECTED_EVENT_PROPS).sort())
})

for (const [event, expectedProps] of Object.entries(EXPECTED_EVENT_PROPS)) {
  Deno.test(`EVENT_ALLOWLIST.${event} permits exactly the documented prop keys`, () => {
    // deno-lint-ignore no-explicit-any
    const entry = (EVENT_ALLOWLIST as any)[event]
    assertEquals(typeof entry, 'object')
    assertEquals([...entry.props].sort(), [...expectedProps].sort())
    assertEquals(typeof entry.description, 'string')
    assertEquals(entry.description.length > 0, true)
  })
}

Deno.test('the two new delivery events carry metadata-only props -- no user_id, no PII, no content key', () => {
  // deno-lint-ignore no-explicit-any
  const replyDelivered = (EVENT_ALLOWLIST as any).collective_reply_delivered
  // deno-lint-ignore no-explicit-any
  const moderationDelivered = (EVENT_ALLOWLIST as any).moderation_notification_delivered
  assertEquals(replyDelivered.props.includes('user_id'), false)
  assertEquals(moderationDelivered.props.includes('user_id'), false)
})

Deno.test('no event in the server allowlist permits a prop key that isContentKey() matches (NFR19, executable on the map itself)', () => {
  const offenders: Array<{ event: string; key: string }> = []
  for (const [event, entry] of Object.entries(EVENT_ALLOWLIST)) {
    for (const key of (entry as { props: readonly string[] }).props) {
      if (isContentKey(key)) offenders.push({ event, key })
    }
  }
  assertEquals(offenders, [])
})

// ---------------------------------------------------------------------------
// validateEventProps -- the shared pure validation core, identical behavior
// to the client twin.
// ---------------------------------------------------------------------------

Deno.test('validateEventProps strips keys not permitted for the event while preserving allowed keys', () => {
  const { sanitizedProps, strippedKeys } = validateEventProps('collective_reply_delivered', {
    recipient_count: 3,
    sent_count: 2,
    failed_count: 1,
    rogue_key: 'nope',
  })
  assertEquals(sanitizedProps, { recipient_count: 3, sent_count: 2, failed_count: 1 })
  assertEquals(strippedKeys, ['rogue_key'])
})

Deno.test('validateEventProps reports documented-but-omitted keys as missing', () => {
  const { missingKeys } = validateEventProps('moderation_notification_delivered', {
    action_type: 'remove_post',
  })
  assertEquals(missingKeys.sort(), ['failed_count', 'sent_count'])
})

Deno.test('validateEventProps yields empty sanitized props (and never throws) for an unknown event', () => {
  let threw = false
  let result: ReturnType<typeof validateEventProps> | null = null
  try {
    result = validateEventProps('not_a_real_event', { x: 1 })
  } catch {
    threw = true
  }
  assertEquals(threw, false)
  assertEquals(result?.sanitizedProps, {})
})

Deno.test('validateEventProps tolerates missing/undefined props without throwing', () => {
  let threw = false
  let result: ReturnType<typeof validateEventProps> | null = null
  try {
    result = validateEventProps('flow_started')
  } catch {
    threw = true
  }
  assertEquals(threw, false)
  assertEquals(result?.sanitizedProps, {})
})
