// packages/ui/src/components/AuthorByline.tsx
//
// Boundary rule (D7): no Legend-State imports in this file.
// Text-only authorship primitive. No avatar, no sigil, no color-shift hooks.
// Re-exported from packages/ui/src/index.tsx.

import { XStack, Text } from 'tamagui'

// ─── Tier → label map ─────────────────────────────────────────────────────────
// Exported so consumers (PostComposer's "posting as" preview, etc.) share the
// same source of truth. Adding a future tier is a single-file edit.

export const TENURE_TIER_LABEL = {
  30: 'Day 30+',
  100: 'Day 100+',
  365: 'Year+',
} as const

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AuthorBylineProps {
  displayName: string
  postedAt: string                   // ISO-8601 string from RPC `created_at`; formatted locally
  tenureTier?: 30 | 100 | 365 | null // optional; from `your_posts` RPC only
  deletedDisplay?: boolean           // when true, name slot renders "[deleted]"; tenure suppressed
}

// ─── Relative time formatter ──────────────────────────────────────────────────
// < 7 days: Intl.RelativeTimeFormat condensed ("3h", "2d")
// >= 7 days: Intl.DateTimeFormat short-date ("May 6")
// No external date library.

function formatPostedAt(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

  if (diffMs < SEVEN_DAYS) {
    // Use condensed relative format
    if (diffHours < 1) {
      return `${Math.max(1, diffMinutes)}m`
    }
    if (diffDays < 1) {
      return `${diffHours}h`
    }
    return `${diffDays}d`
  }

  // >= 7 days: short-date
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(iso)
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthorByline({
  displayName,
  postedAt,
  tenureTier,
  deletedDisplay = false,
}: AuthorBylineProps) {
  const nameSlot = deletedDisplay ? '[deleted]' : displayName
  const timeStr = formatPostedAt(postedAt)
  const tenureLabel =
    !deletedDisplay && tenureTier != null ? TENURE_TIER_LABEL[tenureTier] : null

  // Build the a11y label that flattens to a single screen-reader announcement
  const a11yLabel = [
    `${nameSlot}, posted ${timeStr}`,
    tenureLabel ? `, ${tenureLabel}` : '',
  ].join('')

  return (
    <XStack
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      <Text
        numberOfLines={1}
        fontSize="$1"
        color="$color9"
        fontFamily="$body"
      >
        {nameSlot}
        {' · '}
        {timeStr}
        {tenureLabel ? ' · ' : null}
        {tenureLabel ? (
          <Text
            fontSize="$1"
            color="$color9"
            fontFamily="$body"
            fontStyle="italic"
          >
            {tenureLabel}
          </Text>
        ) : null}
      </Text>
    </XStack>
  )
}

export default AuthorByline
