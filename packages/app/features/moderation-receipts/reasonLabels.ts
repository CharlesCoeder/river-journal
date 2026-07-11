/**
 * Local reason-code → label map for the user-facing moderation receipt.
 *
 * Deliberately duplicated from the admin removal-reason map rather than
 * imported: importing it would cross into the admin-only, mobile-EXCLUDED admin
 * moderation subtree and break the mobile bundle — receipts ship to web +
 * desktop + mobile. Drift between the two maps fails SAFE: any unknown or null
 * code falls back to "Other".
 */

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment',
  off_topic: 'Off-topic',
  spam: 'Spam',
  threats: 'Threats',
  illegal_content: 'Illegal content',
  other: 'Other',
}

/**
 * Maps a bare `removed_reason` CODE to its templated label. Unknown or null
 * codes fall back to "Other" (drift-safe vs the admin map).
 */
export function reasonLabel(code: string | null | undefined): string {
  if (code == null) return 'Other'
  return REASON_LABELS[code] ?? 'Other'
}

/**
 * The single shared community-guidelines URL. MUST match the value the
 * notify_moderation_action Edge Function uses
 * (supabase/functions/notify_moderation_action/index.ts) so the in-app receipt
 * and the future push receipt agree.
 */
export const COMMUNITY_GUIDELINES_URL = 'https://riverjournal.app/community-guidelines'
