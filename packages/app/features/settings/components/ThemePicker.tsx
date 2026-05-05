import { useState } from 'react'
import { Circle, Text, XStack, YStack, View, isWeb } from '@my/ui'
import { ExpandingLineButton } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, setTheme, spendUnlockToken } from 'app/state/store'
import { LIGHT_THEMES, DARK_THEMES } from 'app/state/types'
import type { ThemeName } from 'app/state/types'
import { THEME_DEFS } from '@my/config/src/themes'
import { useUnlockedThemes, getThemePickerTier } from 'app/state/streak'
import type { SubscriptionTier } from 'app/state/streak'
import { useRouter } from 'solito/navigation'
import { CustomThemeEditor } from './CustomThemeEditor'

const THEME_LABELS: Record<ThemeName, string> = {
  ink: 'Ink & Paper',
  night: 'Night Study',
  'forest-morning': 'Forest Morning',
  'forest-night': 'Forest Night',
  leather: 'Worn Leather',
  fireside: 'Fireside',
}

function ThemeRow({
  name,
  isSelected,
  isLocked,
  lockedAffordance,
  onSelect,
  onLockedTap,
}: {
  name: ThemeName
  isSelected: boolean
  isLocked: boolean
  lockedAffordance: string | null
  onSelect: () => void
  onLockedTap: () => void
}) {
  const def = THEME_DEFS[name]
  return (
    <XStack
      testID={`theme-option-${name}${isSelected ? '-selected' : ''}`}
      alignItems="center"
      gap="$3"
      cursor="pointer"
      onPress={isLocked ? onLockedTap : onSelect}
      hoverStyle={{ opacity: 0.8 }}
      pressStyle={{ opacity: 0.7 }}
      opacity={isLocked ? 0.4 : 1}
    >
      <Circle
        size={12}
        borderWidth={1}
        borderColor="$color5"
        backgroundColor={def?.bg ?? 'transparent'}
      />
      <YStack flex={1}>
        <Text
          fontFamily="$journal"
          fontSize={20}
          color={isSelected ? '$color' : '$color8'}
          {...(isWeb && { hoverStyle: { color: '$color' } })}
        >
          {THEME_LABELS[name]}
        </Text>
        {isLocked && lockedAffordance && (
          <Text
            testID={`lock-affordance-${name}`}
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            {lockedAffordance}
          </Text>
        )}
      </YStack>
    </XStack>
  )
}

export function ThemePicker() {
  const currentTheme = use$(store$.profile.themeName) ?? 'ink'
  const customTheme = use$(store$.profile.customTheme)
  const streak = use$(store$.views.streak!)
  // Direct read from profile for "is this theme unlocked?" — single source of truth
  // for unlock-state in the picker. See AC 27: this and useUnlockedThemes('free') are
  // the same data routed differently; direct read avoids a streak-recompute round-trip.
  const unlockedFromProfile = use$(store$.profile.unlockedThemes) ?? []
  const [editorOpen, setEditorOpen] = useState(false)
  const [confirmingTheme, setConfirmingTheme] = useState<ThemeName | null>(null)

  const router = useRouter()

  // TODO(Story 7.1): replace with use$(store$.profile.subscription_tier) ?? 'free'
  const tier: SubscriptionTier = getThemePickerTier()

  // Tokens earned minus tokens already spent
  const availableTokens = Math.max(0, (streak?.unlockTokensEarned ?? 0) - unlockedFromProfile.length)

  const isCustomSelected = currentTheme === 'custom'

  const renderThemeRows = (themes: ThemeName[]) =>
    themes.map((name) => {
      // Determine locked state for free tier.
      // Default themes ('ink', 'night') are NEVER locked — they are the day-1 floor
      // so new users always have at least two applicable themes.
      let isLocked = tier === 'free' && !unlockedFromProfile.includes(name)
      if (name === 'ink' || name === 'night') {
        isLocked = false
      }

      // Locked affordance text
      let lockedAffordance: string | null = null
      if (isLocked) {
        if (availableTokens >= 1) {
          lockedAffordance = '1 token to unlock'
        } else {
          const nextDay = streak?.nextUnlockMilestone ?? '—'
          lockedAffordance = `Day ${nextDay} to unlock another`
        }
      }

      const handleLockedTap = () => {
        // Only open confirm strip when tokens are available
        if (availableTokens >= 1) {
          setConfirmingTheme(name)
        }
        // Zero-token tap is a no-op (affordance text is informational only)
      }

      return (
        <YStack key={name}>
          <ThemeRow
            name={name}
            isSelected={currentTheme === name}
            isLocked={isLocked}
            lockedAffordance={lockedAffordance}
            onSelect={() => setTheme(name)}
            onLockedTap={handleLockedTap}
          />
          {confirmingTheme === name && (
            <YStack
              role="group"
              aria-label={`Unlock ${THEME_LABELS[name]}?`}
              paddingLeft="$6"
              gap="$2"
              paddingTop="$2"
            >
              <Text fontFamily="$body" fontSize={13} color="$color8">
                Unlock {THEME_LABELS[name]}?
              </Text>
              <XStack gap="$3">
                <ExpandingLineButton
                  onPress={() => {
                    spendUnlockToken(name)
                    setConfirmingTheme(null)
                  }}
                >
                  Confirm
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={() => {
                    setConfirmingTheme(null)
                  }}
                >
                  Cancel
                </ExpandingLineButton>
              </XStack>
            </YStack>
          )}
        </YStack>
      )
    })

  return (
    <YStack gap="$3">
      {/* "Unlock everything now" — free tier only. Tap routes to stub paid tier surface.
          STUB destination — Story 7.4 wires the real PaidTierPurchaseSurface. */}
      {tier === 'free' && (
        <ExpandingLineButton
          onPress={() => {
            router.push('/paid/coming-soon')
          }}
        >
          Unlock everything now
        </ExpandingLineButton>
      )}

      {renderThemeRows(LIGHT_THEMES)}

      <View height={16} />

      {renderThemeRows(DARK_THEMES)}

      <View height={16} />

      {/* Custom Theme Row — unchanged (Story 2.10 scope; no unlock-token model here) */}
      {customTheme ? (
        <XStack
          testID={`theme-option-custom${isCustomSelected ? '-selected' : ''}`}
          alignItems="center"
          gap="$3"
          cursor="pointer"
          onPress={() => setTheme('custom')}
          hoverStyle={{ opacity: 0.8 }}
          pressStyle={{ opacity: 0.7 }}
        >
          <Circle
            size={12}
            borderWidth={1}
            borderColor="$color5"
            backgroundColor={customTheme.bg}
          />
          <Text
            fontFamily="$journal"
            fontSize={20}
            color={isCustomSelected ? '$color' : '$color8'}
            {...(isWeb && { hoverStyle: { color: '$color' } })}
            flex={1}
          >
            My Theme
          </Text>
          <Text
            testID="edit-custom-theme"
            fontFamily="$body"
            fontSize={13}
            color="$color8"
            cursor="pointer"
            onPress={(e: any) => {
              e.stopPropagation?.()
              setEditorOpen(true)
            }}
            {...(isWeb ? { hoverStyle: { color: '$color' } } : { pressStyle: { opacity: 0.7 } })}
          >
            Edit
          </Text>
        </XStack>
      ) : (
        <XStack
          testID="create-custom-theme"
          alignItems="center"
          gap="$3"
          cursor="pointer"
          onPress={() => setEditorOpen(true)}
          hoverStyle={{ opacity: 0.8 }}
          pressStyle={{ opacity: 0.7 }}
        >
          <Circle
            size={12}
            borderWidth={1}
            borderColor="$color5"
            borderStyle="dashed"
          />
          <Text
            fontFamily="$journal"
            fontSize={20}
            color="$color8"
            {...(isWeb && { hoverStyle: { color: '$color' } })}
          >
            Create Custom Theme
          </Text>
        </XStack>
      )}

      {editorOpen && <CustomThemeEditor onClose={() => setEditorOpen(false)} />}
    </YStack>
  )
}
