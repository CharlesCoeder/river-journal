import { ScrollView, Separator, Text, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { encryptionSetup$ } from 'app/state/encryptionSetup'
import { PrivacyTierExplainer } from 'app/features/home/components/PrivacyTierExplainer'
import { DataHandlingSection } from './components/DataHandlingSection'

const RETENTION_CONTENT = {
  title: 'Data retention and deletion',
  items: [
    {
      label: 'Cloud data',
      detail:
        'Your synced journal data stays in the cloud until you choose to delete it. We never remove it on our own.',
    },
    {
      label: 'Account deletion',
      detail:
        'Deleting your account permanently wipes all server-side data associated with it.',
    },
    {
      label: 'Local data',
      detail:
        'Journal entries stored on your device always remain as anonymous local data, even after you delete your account or disable sync.',
    },
  ],
} as const

export function PrivacyCenterScreen() {
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const currentMode = use$(encryptionSetup$.currentMode)
  const syncEnabled = use$(store$.session.syncEnabled)

  const effectiveMode =
    isAuthenticated && syncEnabled && currentMode ? currentMode : null

  return (
    <ScrollView>
      <YStack
        testID="privacy-center-screen"
        padding="$4"
        gap="$5"
        maxWidth={640}
        width="100%"
        alignSelf="center"
      >
        <YStack gap="$2">
          <Text fontSize="$8" fontFamily="$body" fontWeight="700">
            Privacy Center
          </Text>
          <Text fontSize="$4" fontFamily="$body" color="$color11">
            How River Journal handles your data and encryption.
          </Text>
        </YStack>

        <Separator />

        <YStack gap="$2">
          <Text fontSize="$6" fontFamily="$body" fontWeight="600">
            Privacy modes
          </Text>
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            {effectiveMode
              ? 'Your current mode is highlighted below.'
              : 'River Journal offers two cloud sync encryption modes, plus fully local storage.'}
          </Text>
          <PrivacyTierExplainer
            selectedMode={effectiveMode}
            showLearnMore={false}
          />
        </YStack>

        <Separator />

        <DataHandlingSection />

        <Separator />

        <YStack gap="$3">
          <Text fontSize="$6" fontFamily="$body" fontWeight="600">
            {RETENTION_CONTENT.title}
          </Text>
          {RETENTION_CONTENT.items.map((item) => (
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
      </YStack>
    </ScrollView>
  )
}
