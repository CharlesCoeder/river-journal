import { useState } from 'react'
import { AnimatePresence, Button, Card, Text, XStack, YStack } from '@my/ui'
import { Shield, Lock } from '@tamagui/lucide-icons'
import type { EncryptionMode } from 'app/types/index'

const TIER_CONTENT = {
  e2e: {
    title: 'Strict Privacy Mode',
    subtitle: 'For advanced users who require absolute, uncompromised privacy.',
    icon: Shield,
    bullets: [
      'You hold the only key to unlock your journal',
      'Total privacy from everyone, including us',
      'Unrecoverable if you ever forget your password',
    ],
  },
  managed: {
    title: 'Cloud Backup Mode',
    subtitle: 'The standard, hassle-free security method used by most everyday apps.',
    icon: Lock,
    bullets: [
      'We securely handle the encryption behind the scenes',
      'Enjoy peace of mind with simple password recovery',
      'We can assist you if you ever get locked out of your account',
    ],
  },
} as const

const LEARN_MORE_CONTENT = [
  {
    label: 'Local only (no sync)',
    detail:
      'Your journal stays entirely on this device. Nothing is ever sent to our servers.',
  },
  {
    label: 'Strict Privacy Mode',
    detail:
      'Content is encrypted on your device before upload using a key derived from your encryption password. We store encrypted data we cannot read. If you lose your password, we cannot recover your cloud data. Local data on your device is unaffected.',
  },
  {
    label: 'Cloud Backup Mode',
    detail:
      'Content is encrypted on your device using a key stored on our server. We may access your data to provide support or account recovery. This is similar to how most cloud services handle your data.',
  },
  {
    label: 'In both sync modes',
    detail:
      'Metadata (word counts, timestamps) is not encrypted and is visible to us. Only journal entry content is encrypted.',
  },
] as const

function TierCard({
  mode,
  content,
  selected,
  interactive,
  onSelect,
}: {
  mode: EncryptionMode
  content: (typeof TIER_CONTENT)[EncryptionMode]
  selected: boolean
  interactive: boolean
  onSelect?: (mode: EncryptionMode) => void
}) {
  const Icon = content.icon
  const bulletColor = selected ? '$color' : '$color11'

  return (
    <Card
      testID={`privacy-tier-${mode}`}
      padding="$4"
      backgroundColor={selected ? '$color3' : '$color2'}
      borderWidth={1}
      borderColor={selected ? '$color8' : '$color4'}
      borderRadius="$4"
      pressTheme={interactive}
      animation={interactive ? 'quick' : undefined}
      onPress={interactive ? () => onSelect?.(mode) : undefined}
      cursor={interactive ? 'pointer' : 'default'}
    >
      <YStack gap="$2">
        <XStack gap="$2" alignItems="center">
          <Icon size={20} color={selected ? '$accentColor' : '$color11'} />
          <Text fontSize="$4" fontFamily="$body" fontWeight="700">
            {content.title}
          </Text>
        </XStack>
        <Text fontSize="$2" fontFamily="$body" color="$color11" paddingLeft="$5">
          {content.subtitle}
        </Text>
        <YStack gap="$1" paddingLeft="$5">
          {content.bullets.map((bullet) => (
            <XStack key={bullet} gap="$2" alignItems="flex-start">
              <Text fontSize="$3" fontFamily="$body" color={bulletColor}>
                •
              </Text>
              <Text fontSize="$3" fontFamily="$body" color={bulletColor} flexShrink={1}>
                {bullet}
              </Text>
            </XStack>
          ))}
        </YStack>
      </YStack>
    </Card>
  )
}

export function PrivacyTierExplainer({
  selectedMode,
  onModeSelect,
  showLearnMore = true,
  privacyCenterLink,
}: {
  selectedMode?: EncryptionMode | null
  onModeSelect?: (mode: EncryptionMode) => void
  showLearnMore?: boolean
  // Story 4.7 — pass navigation handler when Privacy Center screen exists
  privacyCenterLink?: () => void
}) {
  const [learnMoreOpen, setLearnMoreOpen] = useState(false)
  const interactive = !!onModeSelect

  return (
    <YStack gap="$3">
      <TierCard
        mode="e2e"
        content={TIER_CONTENT.e2e}
        selected={selectedMode === 'e2e'}
        interactive={interactive}
        onSelect={onModeSelect}
      />
      <TierCard
        mode="managed"
        content={TIER_CONTENT.managed}
        selected={selectedMode === 'managed'}
        interactive={interactive}
        onSelect={onModeSelect}
      />

      {showLearnMore && (
        <YStack gap="$2">
          <Button
            testID="learn-more-toggle"
            size="$3"
            chromeless
            onPress={() => setLearnMoreOpen((prev) => !prev)}
            fontFamily="$body"
            alignSelf="flex-start"
            color="$color10"
          >
            {learnMoreOpen ? 'Show less' : 'Learn more'}
          </Button>

          <AnimatePresence>
            {learnMoreOpen && (
              <YStack
                key="learn-more-content"
                animation="quick"
                enterStyle={{ opacity: 0, scale: 0.97 }}
                exitStyle={{ opacity: 0, scale: 0.97 }}
                opacity={1}
                scale={1}
                gap="$3"
                paddingTop="$2"
              >
                <Text fontSize="$4" fontFamily="$body" fontWeight="600">
                  How your data is handled
                </Text>

                {LEARN_MORE_CONTENT.map((item) => (
                  <YStack key={item.label} gap="$1">
                    <Text fontSize="$3" fontFamily="$body" fontWeight="600">
                      {item.label}
                    </Text>
                    <Text fontSize="$3" fontFamily="$body" color="$color11">
                      {item.detail}
                    </Text>
                  </YStack>
                ))}

                {privacyCenterLink && (
                  <Button
                    testID="privacy-center-link"
                    size="$3"
                    variant="outlined"
                    onPress={privacyCenterLink}
                    fontFamily="$body"
                    alignSelf="flex-start"
                  >
                    View full Privacy Center
                  </Button>
                )}
              </YStack>
            )}
          </AnimatePresence>
        </YStack>
      )}
    </YStack>
  )
}
