// packages/app/features/settings/SuspensionStatusSection.tsx
//
// Advisory-only active-suspension status for Settings. Shows the expiry +
// reason + the "you can still write and read" scope reminder when the caller
// has an active suspension; renders nothing otherwise. This changes NO
// gating/RLS logic — the collective_posts / collective_reactions INSERT RLS
// remains the authoritative gate on posting/reacting.

import { Text, YStack } from '@my/ui'
import { useMyActiveSuspension } from 'app/state/collective/suspension'

function humanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function SuspensionStatusSection({ userId }: { userId: string | null }) {
  const suspension = useMyActiveSuspension(userId)
  // Render-time expiry guard: the hook filters ends_at > now only at fetch time
  // (staleTime 60s), so a lapsed row can still sit in cache — re-check here so a
  // just-expired suspension never shows as "paused until {a past date}".
  if (suspension === null || new Date(suspension.ends_at).getTime() <= Date.now()) {
    return null
  }
  const reason =
    suspension.reason != null && suspension.reason.trim() !== '' ? suspension.reason : null
  return (
    <YStack
      testID="settings-suspension-status"
      gap="$3"
    >
      <Text
        fontFamily="$body"
        fontSize={11}
        textTransform="uppercase"
        letterSpacing={2}
        color="$color8"
      >
        Account Status
      </Text>
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$color"
        lineHeight={22}
      >
        Your ability to post and react is paused until {humanDate(suspension.ends_at)}. You can
        still write and read.
      </Text>
      {reason ? (
        <Text
          testID="settings-suspension-reason"
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          Reason: {reason}
        </Text>
      ) : null}
    </YStack>
  )
}

export default SuspensionStatusSection
