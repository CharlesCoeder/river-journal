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
