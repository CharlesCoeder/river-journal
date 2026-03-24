import { ScrollView, Separator, Switch, Text, XStack, YStack } from '@my/ui'
import { Smartphone, Lock, Shield } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { encryptionSetup$ } from 'app/state/encryptionSetup'
import { SyncToggle } from 'app/features/home/components/SyncToggle'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { TrustedBrowsersList } from 'app/features/home/components/TrustedBrowsersList'
import { LinkedProviders } from 'app/features/auth/components/LinkedProviders'

// ---------------------------------------------------------------------------
// Privacy Tier — compact 3-column display matching Settings design
// ---------------------------------------------------------------------------

type TierKey = 'local' | 'managed' | 'e2e'

const TIERS: { key: TierKey; label: string; description: string; icon: typeof Smartphone }[] = [
  { key: 'local', label: 'Local Only', description: 'Entries never leave this device', icon: Smartphone },
  { key: 'managed', label: 'Managed Encryption', description: 'We handle encryption for you', icon: Lock },
  { key: 'e2e', label: 'E2E Encryption', description: 'Only you hold the key', icon: Shield },
]

function getActiveTier(isAuthenticated: boolean, currentMode: string | null): TierKey {
  if (!isAuthenticated || !currentMode) return 'local'
  if (currentMode === 'e2e') return 'e2e'
  return 'managed'
}

function PrivacyTierRow({ activeTier }: { activeTier: TierKey }) {
  return (
    <XStack
      gap="$3"
      $max-sm={{ flexDirection: 'column', gap: '$0' }}
    >
      {TIERS.map((tier, index) => {
        const isActive = tier.key === activeTier
        const Icon = tier.icon
        const isLast = index === TIERS.length - 1
        return (
          <YStack
            key={tier.key}
            flex={1}
            gap="$2"
            paddingVertical="$3"
            paddingHorizontal="$2"
            borderRightWidth={isLast ? 0 : 1}
            borderColor="$color5"
            $max-sm={{
              borderRightWidth: 0,
              borderBottomWidth: isLast ? 0 : 1,
              borderColor: '$color5',
            }}
          >
            <XStack gap="$2" alignItems="center">
              <Icon size={16} color={isActive ? '$color' : '$color8'} />
              {isActive && (
                <Text
                  fontSize="$1"
                  fontFamily="$body"
                  fontWeight="700"
                  color="$blue10"
                  textTransform="uppercase"
                  letterSpacing={1}
                >
                  Active
                </Text>
              )}
            </XStack>
            <Text
              fontSize="$5"
              fontFamily="$body"
              fontWeight={isActive ? '600' : '400'}
              color={isActive ? '$color' : '$color9'}
            >
              {tier.label}
            </Text>
            <Text fontSize="$2" fontFamily="$body" color={isActive ? '$color10' : '$color8'}>
              {tier.description}
            </Text>
          </YStack>
        )
      })}
    </XStack>
  )
}

// ---------------------------------------------------------------------------
// Theme placeholder
// ---------------------------------------------------------------------------

const THEME_OPTIONS = [
  { name: 'Ink & Paper', id: 'light' },
  { name: 'Night Study', id: 'dark' },
  { name: 'Pure White', id: 'pure-white' },
]

function ThemeRow({
  name,
  isCurrent,
}: {
  name: string
  isCurrent: boolean
}) {
  return (
    <YStack>
      <XStack
        paddingVertical="$4"
        alignItems="center"
        justifyContent="space-between"
      >
        <Text
          fontSize="$5"
          fontFamily="$body"
          fontWeight={isCurrent ? '600' : '400'}
          color={isCurrent ? '$color' : '$color9'}
        >
          {name}
        </Text>
        {isCurrent && (
          <Text
            fontSize="$1"
            fontFamily="$body"
            fontWeight="700"
            color="$blue10"
            textTransform="uppercase"
            letterSpacing={1.5}
          >
            Current
          </Text>
        )}
      </XStack>
      <Separator borderColor="$color5" />
    </YStack>
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
  const baseTheme = use$(store$.profile.baseTheme) ?? 'light'

  const activeTier = getActiveTier(isAuthenticated, currentMode)

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        testID="settings-screen"
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
        {/* Header */}
        <YStack gap="$2">
          <Text fontSize="$10" fontFamily="$body" fontWeight="300" color="$color">
            Settings
          </Text>
          <Text
            fontSize="$2"
            fontFamily="$body"
            color="$color9"
            textTransform="uppercase"
            letterSpacing={2}
          >
            Preferences & Privacy
          </Text>
        </YStack>

        <Separator borderColor="$color5" />

        {/* Privacy Tier */}
        <YStack gap="$4">
          <Text
            fontSize="$2"
            fontFamily="$body"
            color="$color9"
            textTransform="uppercase"
            letterSpacing={2}
          >
            Privacy Tier
          </Text>
          <PrivacyTierRow activeTier={activeTier} />
        </YStack>

        <Separator borderColor="$color5" />

        {/* Cloud Sync — reuse existing SyncToggle for authenticated users,
            or show a simpler inline toggle for unauthenticated */}
        {isAuthenticated ? (
          <SyncToggle />
        ) : (
          <XStack
            alignItems="center"
            justifyContent="space-between"
            paddingVertical="$2"
          >
            <YStack gap="$1">
              <Text fontSize="$5" fontFamily="$body" fontWeight="600" color="$color">
                Cloud sync
              </Text>
              <Text fontSize="$3" fontFamily="$body" color="$color10">
                Entries remain on this device only
              </Text>
            </YStack>
            <Switch
              size="$4"
              checked={false}
              disabled
            >
              <Switch.Thumb animation="quick" />
            </Switch>
          </XStack>
        )}

        {/* Keyring prompt — shown after password entry on native platforms */}
        <KeyringPrompt />

        {/* Trusted browsers — E2E authenticated users only */}
        {isAuthenticated && userId && currentMode === 'e2e' && (
          <>
            <Separator borderColor="$color5" />
            <TrustedBrowsersList userId={userId} />
          </>
        )}

        {/* Linked accounts — authenticated users only */}
        {isAuthenticated && (
          <>
            <Separator borderColor="$color5" />
            <LinkedProviders />
          </>
        )}

        <Separator borderColor="$color5" />

        {/* Theme — placeholder */}
        <YStack gap="$3">
          <Text
            fontSize="$2"
            fontFamily="$body"
            color="$color9"
            textTransform="uppercase"
            letterSpacing={2}
          >
            Theme
          </Text>

          {THEME_OPTIONS.map((theme) => (
            <ThemeRow
              key={theme.id}
              name={theme.name}
              isCurrent={theme.id === baseTheme}
            />
          ))}
        </YStack>

        {/* Footer */}
        <XStack
          justifyContent="space-between"
          alignItems="center"
          paddingTop="$6"
        >
          <Text
            fontSize="$1"
            fontFamily="$body"
            color="$color8"
            textTransform="uppercase"
            letterSpacing={1.5}
          >
            River Journal · v1.0.0
          </Text>
          <Text
            fontSize="$1"
            fontFamily="$body"
            color="$color8"
            textTransform="uppercase"
            letterSpacing={1.5}
            cursor="pointer"
            onPress={() => router.push('/privacy')}
            hoverStyle={{ color: '$color' }}
          >
            About
          </Text>
        </XStack>
      </YStack>

      {/* Dialog — must be mounted here so SyncToggle's "Enter encryption password" works */}
      <EncryptionModeDialog />
    </ScrollView>
  )
}

