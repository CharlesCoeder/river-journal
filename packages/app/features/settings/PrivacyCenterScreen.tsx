import { ScrollView, Separator, Text, YStack, XStack, Button } from '@my/ui'
import { ArrowLeft } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
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
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const currentMode = use$(encryptionSetup$.currentMode)
  const syncEnabled = use$(store$.session.syncEnabled)

  const effectiveMode =
    isAuthenticated && syncEnabled && currentMode ? currentMode : null

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        testID="privacy-center-screen"
        width="100%"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom="$10"
        gap="$6"
        $sm={{
          maxWidth: 640,
          alignSelf: 'center',
          paddingHorizontal: 0,
          paddingTop: '$6',
        }}
      >
        {/* Back navigation */}
        <XStack width="100%">
          <Button
            size="$3"
            chromeless
            onPress={() => router.push('/')}
            icon={ArrowLeft}
            color="$color9"
            opacity={0.6}
            hoverStyle={{ opacity: 1 }}
          />
        </XStack>

        {/* Header */}
        <YStack gap="$2" paddingTop="$2">
          <Text fontSize="$9" fontFamily="$body" fontWeight="300" color="$color">
            Privacy Center
          </Text>
          <Text fontSize="$4" fontFamily="$body" color="$color10">
            How River Journal handles your data and encryption.
          </Text>
        </YStack>

        <Separator borderColor="$color5" />

        {/* Privacy modes section */}
        <YStack gap="$3">
          <Text fontSize="$6" fontFamily="$body" fontWeight="600" color="$color">
            Privacy modes
          </Text>
          <Text fontSize="$3" fontFamily="$body" color="$color10">
            {effectiveMode
              ? 'Your current mode is highlighted below.'
              : 'River Journal offers two cloud sync encryption modes, plus fully local storage.'}
          </Text>
          <PrivacyTierExplainer
            selectedMode={effectiveMode}
            showLearnMore={false}
          />
        </YStack>

        <Separator borderColor="$color5" />

        {/* Data handling section */}
        <DataHandlingSection />

        <Separator borderColor="$color5" />

        {/* Retention section */}
        <YStack gap="$4">
          <Text fontSize="$6" fontFamily="$body" fontWeight="600" color="$color">
            {RETENTION_CONTENT.title}
          </Text>
          {RETENTION_CONTENT.items.map((item) => (
            <YStack key={item.label} gap="$1.5">
              <Text fontSize="$4" fontFamily="$body" fontWeight="600" color="$color">
                {item.label}
              </Text>
              <Text fontSize="$3" fontFamily="$body" color="$color10">
                {item.detail}
              </Text>
            </YStack>
          ))}
        </YStack>
      </YStack>
    </ScrollView>
  )
}
