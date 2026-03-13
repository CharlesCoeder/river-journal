import { Text, YStack } from '@my/ui'

const DATA_HANDLING_CONTENT = [
  {
    label: 'Local only (no sync)',
    detail:
      'Your journal stays entirely on this device. Nothing is ever sent to our servers. Your entries are never uploaded, backed up, or accessible from other devices.',
  },
  {
    label: 'Strict Privacy Mode (end-to-end encryption)',
    detail:
      'We store encrypted data we cannot read. Your journal content is encrypted on your device before it ever leaves, using a key derived from your encryption password. If you lose your password, we cannot recover your cloud data. Local data on your device is unaffected.',
  },
  {
    label: 'Cloud Backup Mode (managed encryption)',
    detail:
      'We can access your data to provide support and account recovery. Your content is encrypted on your device using a key stored on our server. This is similar to how most cloud services handle your data.',
  },
  {
    label: 'In both sync modes',
    detail:
      'Metadata such as word counts and timestamps is not encrypted and is visible to us. Only journal entry content is encrypted.',
  },
] as const

export function DataHandlingSection() {
  return (
    <YStack testID="data-handling-section" gap="$3">
      <Text fontSize="$6" fontFamily="$body" fontWeight="600">
        What we can and cannot access
      </Text>
      {DATA_HANDLING_CONTENT.map((item) => (
        <YStack key={item.label} gap="$1">
          <Text fontSize="$4" fontFamily="$body" fontWeight="600">
            {item.label}
          </Text>
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            {item.detail}
          </Text>
        </YStack>
      ))}
    </YStack>
  )
}
