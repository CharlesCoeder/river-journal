// eventAllowlist.ts — the server-side (Deno/Edge) single source of truth for
// every product-analytics event the Edge Functions may emit, and the exact
// prop keys each event is permitted to carry.
//
// CROSS-RUNTIME SYNC (keep these aligned by hand — they are NOT one import):
//  - This is a hand-maintained MIRROR of
//    `packages/app/utils/telemetry/eventAllowlist.ts`. Edge Functions run in a
//    separate Deno runtime/bundle and CANNOT import from `packages/app`, so the
//    client allowlist is duplicated here (the same sanctioned pattern as the
//    `contentKeys.ts` mirror pair). Any event added, removed, or changed in the
//    client file — its name or its permitted prop keys — must be added, removed,
//    or changed identically here.
//  - The parity test
//    `packages/app/utils/telemetry/__tests__/eventAllowlistServerParity.test.ts`
//    imports BOTH files (both are dependency-free and Node-importable) and fails
//    closed if the two ever silently diverge.
//
// DEPENDENCY-FREE BY DESIGN: this module MUST NOT import any SDK or platform
// API (no `Deno.*`, no npm/jsr), so `deno test` and the Node parity test can
// both load it.
//
// CONTENT-KEY INVARIANT (NFR19): a content-shaped prop key (`body`, `content`,
// `note`, `reason`, ... — anything `isContentKey()` matches) can NEVER appear
// in a `props` list. An executable test (`eventAllowlist.test.ts`) pins this on
// the map itself.

/** Shape of a single allowlist entry: the permitted prop keys + a one-line doc. */
export type EventAllowlistEntry = {
  readonly props: readonly string[]
  readonly description: string
}

/**
 * The full allowlist — the byte-faithful mirror of the client map. Every event
 * the product captures, client-originated AND server/cron-originated, appears
 * here with its exact permitted prop keys.
 */
export const EVENT_ALLOWLIST = {
  // ─── v2 success-metric + client product events ────────────────────────────
  flow_started: {
    props: ['user_id', 'tier'],
    description: 'A writing session began at the "Begin Writing" CTA.',
  },
  flow_completed: {
    props: ['user_id', 'tier', 'word_count_bucket'],
    description: 'A writing session was saved; word count is bucketed, never raw.',
  },
  flow_500_crossed: {
    props: ['user_id', 'tier'],
    description: 'The active flow crossed from under 500 to 500+ words (once per flow).',
  },
  streak_unlock_earned: {
    props: ['user_id', 'tier', 'milestone'],
    description: 'A streak milestone theme unlock was earned and surfaced.',
  },
  collective_post_submitted: {
    props: ['user_id', 'tier'],
    description: 'A Collective post (top-level letter or reply) was created successfully.',
  },
  collective_reaction_toggled: {
    props: ['user_id', 'tier', 'reaction_kind'],
    description: 'A reaction was toggled (added or removed) on a Collective post.',
  },
  collective_report_submitted: {
    props: ['user_id', 'tier'],
    description: 'A Collective post was reported (metadata only — never the note text).',
  },
  collective_reply_delivered: {
    props: ['recipient_count', 'sent_count', 'failed_count'],
    description: 'A Collective reply push fan-out ran (aggregate delivery counts; server-emitted).',
  },

  // ─── Subscription events ──────────────────────────────────────────────────
  subscription_purchased: {
    props: ['user_id', 'provider', 'tier'],
    description: 'A paid subscription was purchased (server-emitted).',
  },
  subscription_cancel_initiated: {
    props: ['user_id', 'provider', 'tier'],
    description: 'The user began the subscription cancel flow.',
  },
  subscription_cancel_confirmed: {
    props: ['user_id', 'provider', 'tier'],
    description: 'A subscription cancellation reached a confirmed terminal state.',
  },
  account_deleted: {
    props: ['tier'],
    description: 'A user account was deleted (server-emitted; no user_id retained).',
  },

  // ─── Moderation events (server-emitted) ───────────────────────────────────
  moderation_action_taken: {
    props: ['action_type', 'anonymized_actor', 'target_type'],
    description: 'A moderator took an action on a queued item (server-emitted).',
  },
  moderation_suspension_applied: {
    props: ['kind', 'duration_days', 'anonymized_actor'],
    description: 'A suspension was applied to a user (server-emitted).',
  },
  moderation_notification_delivered: {
    props: ['action_type', 'sent_count', 'failed_count'],
    description:
      'A moderation notification push fan-out ran (aggregate delivery counts; server-emitted).',
  },

  // ─── Operational-health cron events ───────────────────────────────────────
  moderation_queue_depth_sample: {
    props: ['pending_count', 'oldest_pending_age_seconds'],
    description: 'A periodic sample of the moderation queue depth (cron-emitted).',
  },
  sync_opt_in_snapshot: {
    props: ['opted_in_count', 'total_count'],
    description: 'A once-per-day snapshot of Cloud Sync opt-in counts (cron-emitted).',
  },
} as const satisfies Record<string, EventAllowlistEntry>

/** The set of every event name the product is allowed to capture. */
export type AllowlistedEvent = keyof typeof EVENT_ALLOWLIST

/** Result of validating an emit payload against the allowlist. */
export interface ValidatedEventProps {
  /** Props whose keys are permitted for the event (unknown keys removed). */
  sanitizedProps: Record<string, unknown>
  /** Keys that were present but not permitted for the event (stripped). */
  strippedKeys: string[]
  /** Documented keys for the event that the caller did not supply. */
  missingKeys: string[]
}

/**
 * Pure validation shared by the server emitter and its tests — the identical
 * core to the client twin.
 *
 * - Keys not permitted for `event` are removed and reported in `strippedKeys`.
 * - Documented keys the caller omitted are reported in `missingKeys`.
 * - An event name absent from the allowlist yields empty results and never
 *   throws (the no-op contract `emitServerEvent` relies on).
 */
export function validateEventProps(
  event: string,
  props?: Record<string, unknown> | null,
): ValidatedEventProps {
  const entry = (EVENT_ALLOWLIST as Record<string, EventAllowlistEntry>)[event]
  const safeProps = props ?? {}

  if (!entry) {
    return { sanitizedProps: {}, strippedKeys: Object.keys(safeProps), missingKeys: [] }
  }

  const allowed = new Set(entry.props)
  const sanitizedProps: Record<string, unknown> = {}
  const strippedKeys: string[] = []

  for (const key of Object.keys(safeProps)) {
    if (allowed.has(key)) {
      sanitizedProps[key] = safeProps[key]
    } else {
      strippedKeys.push(key)
    }
  }

  const missingKeys = entry.props.filter((key) => !(key in safeProps))

  return { sanitizedProps, strippedKeys, missingKeys }
}
