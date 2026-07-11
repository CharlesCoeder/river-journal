// packages/app/features/moderation/AdminAuditLogScreen.tsx
//
// INTENTIONAL PLACEHOLDER — superseded by the real audit-log screen in a later
// change. It exists now only so the admin routes compile and the route gate is
// exercisable. Keep it platform-agnostic (no platform-only imports) so web +
// desktop render identically.

import { Text, YStack } from '@my/ui'

export function AdminAuditLogScreen() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      data-testid="admin-audit-log-screen"
    >
      <Text fontSize="$7" fontWeight="600">
        Audit log
      </Text>
      <Text opacity={0.7}>Coming soon.</Text>
    </YStack>
  )
}

export default AdminAuditLogScreen
