/**
 * eventAllowlist.ts — the single source of truth for every product-analytics
 * event the product captures, and the exact prop keys each event is permitted
 * to emit.
 *
 * CROSS-SURFACE CONTRACT (do NOT fork per-consumer copies):
 * This map is consumed by THREE surfaces that must agree:
 *  1. `captureEvent` (the ONLY sanctioned client capture path) validates every
 *     call against this map before sending.
 *  2. `scripts/lint-posthog-events.mjs` (the CI lint) reads this same map to
 *     statically reject any `captureEvent(...)` call that names an unknown
 *     event or passes an unpermitted prop key.
 *  3. The server-side emitters (Edge Functions) and the operational-health cron
 *     reuse THIS map as the single source of truth for their event shapes —
 *     they enumerate their events here and add no client call site.
 *
 * DEPENDENCY-FREE BY DESIGN: this module MUST NOT import `posthog-js`,
 * `posthog-react-native`, or any platform-only code, so it is safe to import
 * from shared code, from the Node CI lint script, and from pure Vitest unit
 * tests. This mirrors the `contentKeys.ts` / `redactor.ts` testability split
 * established for the crash-telemetry redactor.
 *
 * CROSS-RUNTIME SYNC (keep these aligned by hand — they are NOT one import):
 * The Deno/Edge server-side emitters keep a MIRROR of this file at
 * `supabase/functions/_shared/eventAllowlist.ts`. Edge Functions run in a
 * separate Deno runtime/bundle and CANNOT import from `packages/app`, so that
 * copy is a hand-maintained duplicate (the same sanctioned pattern as the
 * `contentKeys.ts` mirror pair). Any event added, removed, or changed in THIS
 * file — its name or its permitted prop keys — must be added, removed, or
 * changed identically in the server mirror. A parity test
 * (`__tests__/eventAllowlistServerParity.test.ts`) fails closed if the two
 * ever silently diverge.
 *
 * CONTENT-KEY INVARIANT: a content-shaped prop key (`body`, `content`,
 * `note`, `postBody`, `flowContent`, or anything `isContentKey()` matches) can
 * NEVER appear in a `props` list. This is enforced statically by the CI lint
 * (which derives the denylist from `contentKeys.ts`, the single source of
 * truth) and by an executable test twin — it is NOT re-hardcoded here.
 */

/** Shape of a single allowlist entry: the permitted prop keys + a one-line doc. */
export type EventAllowlistEntry = {
  readonly props: readonly string[]
  readonly description: string
}

/**
 * The full allowlist. Every event the product captures — client-originated
 * (instrumented in this app) AND server/cron-originated (enumerated here for
 * the Edge Functions and the operational-health cron to consume) — appears
 * here with its exact permitted prop keys.
 *
 * `word_count` is deliberately NEVER a permitted prop: word counts are emitted
 * only as the bucketed `word_count_bucket` (see `getWordCountBucket`), never as
 * a raw number.
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

/** The four word-count buckets emitted for `flow_completed`. Never a raw count. */
export type WordCountBucket = '<100' | '100-499' | '500-999' | '1000+'

/**
 * Maps a raw word count to its emitted bucket. Boundaries are lower-inclusive:
 * `<100` (0–99), `100-499`, `500-999`, `1000+`. The raw number is NEVER emitted —
 * only the bucket string leaves the device.
 */
export function getWordCountBucket(count: number): WordCountBucket {
  if (count < 100) return '<100'
  if (count < 500) return '100-499'
  if (count < 1000) return '500-999'
  return '1000+'
}

/** Result of validating a `captureEvent` payload against the allowlist. */
export interface ValidatedEventProps {
  /** Props whose keys are permitted for the event (unknown keys removed). */
  sanitizedProps: Record<string, unknown>
  /** Keys that were present but not permitted for the event (stripped). */
  strippedKeys: string[]
  /** Documented keys for the event that the caller did not supply. */
  missingKeys: string[]
}

/**
 * Pure validation shared by `captureEvent`, the CI lint, and unit tests — the
 * single validation implementation (the analog of `redactor.ts`'s pure core).
 *
 * - Keys not permitted for `event` are removed and reported in `strippedKeys`.
 * - Documented keys the caller omitted are reported in `missingKeys`.
 * - An event name absent from the allowlist yields empty results and never
 *   throws (the no-op contract `captureEvent` relies on).
 */
export function validateEventProps(
  event: string,
  props?: Record<string, unknown> | null
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
