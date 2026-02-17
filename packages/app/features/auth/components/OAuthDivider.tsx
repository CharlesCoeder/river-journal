/**
 * OAuthDivider - "or" separator between OAuth buttons and email form
 */

import { XStack, Text, Separator } from '@my/ui'

export function OAuthDivider() {
  return (
    <XStack alignItems="center" gap="$3" width="100%">
      <Separator flex={1} />
      <Text fontSize="$3" color="$color10" fontFamily="$body">
        or
      </Text>
      <Separator flex={1} />
    </XStack>
  )
}
