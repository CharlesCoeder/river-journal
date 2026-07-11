// packages/app/features/moderation/AdminModerationScreen.tsx
//
// INTENTIONAL PLACEHOLDER — superseded by the real moderation queue screen in a
// later change. It exists now only so the admin routes compile and the route
// gate is exercisable. Keep it platform-agnostic (no platform-only imports) so
// web + desktop render identically.

import { Text, YStack } from '@my/ui'

export function AdminModerationScreen() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      data-testid="admin-moderation-screen"
    >
      <Text fontSize="$7" fontWeight="600">
        Moderation
      </Text>
      <Text opacity={0.7}>Coming soon.</Text>
    </YStack>
  )
}

export default AdminModerationScreen
