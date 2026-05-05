import { use$ } from '@legendapp/state/react'
import { Text, View, YStack } from '@my/ui'
import { graceDays$ } from 'app/state/grace_days'
import type { GraceDay } from 'app/state/types'

/**
 * GraceDayInventory — displays the user's available (unspent, non-deleted) grace days.
 *
 * Reads graceDays$ directly via use$() (synchronous, from IndexedDB/MMKV cache).
 * No spinner, no Suspense boundary — renders cached value immediately.
 *
 * TODO(grace-day-writer): when grace days are first auto-applied,
 *   render a subtle "recently used" indicator here.
 */
export function GraceDayInventory() {
  const all = use$(graceDays$)
  const available = Object.values(all ?? {}).filter(
    (g): g is GraceDay =>
      g != null &&
      !(g as { is_deleted?: boolean }).is_deleted &&
      g.usedForDate === null
  )
  const count = available.length
  const text =
    count === 0
      ? 'No grace days yet.'
      : `${count} grace ${count === 1 ? 'day' : 'days'} available.`
  const color = count === 0 ? '$color8' : '$color'

  return (
    <View role="status" aria-live="polite">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" color={color}>
          {text}
        </Text>
      </YStack>
    </View>
  )
}
