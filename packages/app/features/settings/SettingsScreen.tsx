import { ScrollView, Text, XStack, YStack, View } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { encryptionSetup$ } from 'app/state/encryptionSetup'
import { signOut } from 'app/utils'
import { useCallback, useState } from 'react'
import { SyncToggle } from 'app/features/home/components/SyncToggle'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { TrustedBrowsersList } from 'app/features/home/components/TrustedBrowsersList'
import { LinkedProviders } from 'app/features/auth/components/LinkedProviders'
import { ThemePicker } from './components/ThemePicker'

// ---------------------------------------------------------------------------
// Privacy Tier — stacked vertical list matching design
// ---------------------------------------------------------------------------

type TierKey = 'local' | 'managed' | 'e2e'

const TIERS: { key: TierKey; label: string; description: string }[] = [
  { key: 'local', label: 'Local Only', description: 'Entries never leave this device.' },
  { key: 'managed', label: 'Managed Encryption', description: 'We handle encryption for you.' },
  { key: 'e2e', label: 'E2E Encryption', description: 'Only you hold the key.' },
]

function getActiveTier(isAuthenticated: boolean, currentMode: string | null): TierKey {
  if (!isAuthenticated || !currentMode) return 'local'
  if (currentMode === 'e2e') return 'e2e'
  return 'managed'
}

function PrivacyTierList({ activeTier }: { activeTier: TierKey }) {
  return (
    <YStack gap="$2">
      {TIERS.map((tier) => {
        const isActive = tier.key === activeTier
        return (
          <YStack key={tier.key} opacity={isActive ? 1 : 0.4}>
            <Text
              fontFamily="$journal"
              fontSize={24}
              fontWeight={isActive ? '500' : '400'}
              color="$color"
            >
              {tier.label}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$color7"
              marginTop={2}
            >
              {tier.description}
            </Text>
          </YStack>
        )
      })}
    </YStack>
  )
}

// ---------------------------------------------------------------------------
// Section header — all-caps micro label
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={11}
      textTransform="uppercase"
      letterSpacing={2}
      color="$color8"
    >
      {children}
    </Text>
  )
}

// ---------------------------------------------------------------------------
// Settings Screen
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const userId = use$(store$.session.userId)
  const syncEnabled = use$(store$.session.syncEnabled)
  const currentMode = use$(encryptionSetup$.currentMode)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const activeTier = getActiveTier(isAuthenticated, currentMode)

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await signOut()
      router.push('/')
    } finally {
      setIsLoggingOut(false)
    }
  }, [router])

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        testID="settings-screen"
        width="100%"
        maxWidth={768}
        alignSelf="center"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={96}
        $sm={{ paddingHorizontal: '$6' }}
        $md={{ paddingHorizontal: '$8', paddingTop: '$8' }}
        $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
      >
        {/* Header */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom={64} $md={{ marginBottom: 96 }}>
          <Text
            fontFamily="$journalItalic"
            fontStyle="italic"
            fontSize={30}
            color="$color"
            letterSpacing={-0.5}
          >
            Settings
          </Text>
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$color8"
            letterSpacing={0.5}
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={() => router.push('/')}
          >
            Back to Home
          </Text>
        </XStack>

        {/* Sections container */}
        <YStack gap={80}>

          {/* Secure Your Words (unauthenticated) */}
          {!isAuthenticated && (
            <YStack gap="$3">
              <Text fontFamily="$journal" fontSize={24} color="$color">
                Secure Your Words
              </Text>
              <Text
                fontFamily="$body"
                fontSize={14}
                color="$color8"
                lineHeight={22}
                maxWidth={512}
              >
                Create an account or log in to enable end-to-end encrypted backup and sync your journal across all your devices.
              </Text>
              <Text
                fontFamily="$body"
                fontSize={11}
                letterSpacing={3}
                fontWeight="500"
                textTransform="uppercase"
                color="$color"
                borderBottomWidth={2}
                borderColor="$color10"
                paddingBottom={6}
                alignSelf="flex-start"
                marginTop="$2"
                cursor="pointer"
                hoverStyle={{ opacity: 0.7 }}
                onPress={() => router.push('/auth')}
              >
                Log In / Create Account
              </Text>
            </YStack>
          )}

          {/* Privacy Tier (authenticated) */}
          {isAuthenticated && (
            <YStack gap="$4">
              <SectionHeader>Privacy Tier</SectionHeader>
              <PrivacyTierList activeTier={activeTier} />
            </YStack>
          )}

          {/* Data & Sync */}
          {isAuthenticated ? (
            <YStack gap="$4">
              <SectionHeader>Data & Sync</SectionHeader>
              <SyncToggle />
            </YStack>
          ) : (
            <YStack gap="$4">
              <SectionHeader>Data & Sync</SectionHeader>
              <YStack gap="$2">
                <Text
                  fontFamily="$journal"
                  fontSize={20}
                  color="$color8"
                  borderBottomWidth={1}
                  borderColor="$color5"
                  paddingBottom={4}
                  alignSelf="flex-start"
                  cursor="pointer"
                  hoverStyle={{ color: '$color' }}
                  onPress={() => router.push('/auth')}
                >
                  Enable Cloud Sync
                </Text>
                <Text fontFamily="$body" fontSize={13} color="$color8">
                  Entries remain on this device only.
                </Text>
              </YStack>
            </YStack>
          )}

          {/* Keyring prompt */}
          <KeyringPrompt />

          {/* Trusted Browsers (E2E authenticated) */}
          {isAuthenticated && userId && currentMode === 'e2e' && (
            <YStack gap="$4">
              <SectionHeader>Trusted Browsers</SectionHeader>
              <TrustedBrowsersList userId={userId} />
            </YStack>
          )}

          {/* Theme */}
          <YStack gap="$4">
            <SectionHeader>Theme</SectionHeader>
            <ThemePicker />
          </YStack>

          {/* Linked Accounts (authenticated) */}
          {isAuthenticated && (
            <YStack gap="$4">
              <SectionHeader>Linked Accounts</SectionHeader>
              <LinkedProviders />

              {/* Log Out */}
              <Text
                fontFamily="$body"
                fontSize={11}
                letterSpacing={2}
                textTransform="uppercase"
                color="$color8"
                cursor="pointer"
                hoverStyle={{ color: '$color' }}
                onPress={handleLogout}
                alignSelf="flex-start"
                marginTop="$2"
                opacity={isLoggingOut ? 0.4 : 1}
              >
                {isLoggingOut ? 'Logging out...' : 'Log Out'}
              </Text>
            </YStack>
          )}
        </YStack>

        {/* Footer */}
        <XStack
          justifyContent="space-between"
          alignItems="center"
          marginTop={96}
        >
          <Text
            fontFamily="$journal"
            fontSize={13}
            color="$color"
            opacity={0.6}
            letterSpacing={0.5}
          >
            River Journal{'  '}
            <Text fontFamily="$body" fontSize={13} color="$color8">
              · v1.0.0
            </Text>
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$color7"
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={() => router.push('/privacy')}
          >
            Privacy Center
          </Text>
        </XStack>
      </YStack>

      <EncryptionModeDialog />
    </ScrollView>
  )
}
