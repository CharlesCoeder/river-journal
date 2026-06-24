// packages/app/features/collective/_shared.tsx
//
// Shared helpers for collective screen components.
// Extracted from CollectiveFeedScreen to avoid copy-paste drift.
//
// Exports:
//   - formatTimeAgo: relative time formatter for offline strip
//   - SkeletonRows: loading placeholder rows

import { XStack } from '@my/ui'

// ─── Relative time formatter for offline strip ────────────────────────────────
export function formatTimeAgo(ms: number): string {
  const diffMs = Date.now() - ms
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours >= 1) return `${diffHours}h`
  if (diffMinutes >= 1) return `${diffMinutes}m`
  return 'just now'
}

// ─── Warm relative time for post bylines (title-led redesign) ──────────────────
// Phrasing matches the design's tone ("2h ago", "yesterday", "3d ago"). Takes an
// ISO-8601 string (RPC `created_at`). Shared by the feed row + thread view.
export function timeAgoCasual(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'yesterday'
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  return `${Math.floor(day / 30)}mo ago`
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────
const SKELETON_WIDTHS = ['85%', '70%', '92%', '60%', '78%'] as const

export function SkeletonRows({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <>
      {SKELETON_WIDTHS.map((width, i) => (
        <XStack
          key={i}
          data-testid={`skeleton-row-${i}`}
          height={14}
          borderRadius={0}
          backgroundColor="$color3"
          opacity={0.6}
          marginVertical="$2"
          width={width as string}
          animation={reducedMotion ? undefined : 'quick'}
          enterStyle={reducedMotion ? undefined : { opacity: 0 }}
        />
      ))}
    </>
  )
}
