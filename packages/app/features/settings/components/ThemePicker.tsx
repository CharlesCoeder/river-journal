import { useState } from 'react'
import { ExpandingLineButton } from '@my/ui'
import { Text, View } from '@tamagui/tailwind'
import { use$ } from '@legendapp/state/react'
import { store$, setTheme, spendUnlockToken } from 'app/state/store'
import { LIGHT_THEMES, DARK_THEMES } from 'app/state/types'
import type { ThemeName } from 'app/state/types'
import { THEME_DEFS } from '@my/config/src/themes'
import { useUnlockedThemes, getThemePickerTier } from 'app/state/streak'
import type { SubscriptionTier, StreakState } from 'app/state/streak'
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
    <View
      testID={`theme-option-${name}${isSelected ? '-selected' : ''}`}
      className={`flex-row items-center gap-3 cursor-pointer ${isLocked ? 'opacity-40' : 'opacity-100'} hover:opacity-80 press:opacity-70`}
      onPress={isLocked ? onLockedTap : onSelect}
    >
      {/* A runtime color has no class name, so it stays in style. */}
      <View
        className="size-[12px] rounded-[9999px] border border-color5"
        style={{ backgroundColor: def?.bg ?? 'transparent' }}
      />
      <View className="flex-1">
        <Text
          className={`font-journal text-[20px] ${isSelected ? 'text-color' : 'text-color8'} web:hover:text-color`}
        >
          {THEME_LABELS[name]}
        </Text>
        {isLocked && lockedAffordance && (
          <Text
            testID={`lock-affordance-${name}`}
            className="font-body text-[13px] text-color8"
          >
            {lockedAffordance}
          </Text>
        )}
      </View>
    </View>
  )
}

export function ThemePicker() {
  const currentTheme = use$(store$.profile.themeName) ?? 'ink'
  const customTheme = use$(store$.profile.customTheme)
  const streak = use$(store$.views.streak!) as unknown as StreakState
  // Direct read from profile for "is this theme unlocked?" — single source of truth
  // for unlock-state in the picker. This and useUnlockedThemes('free') are the same
  // data routed differently; the direct read avoids a streak-recompute round-trip.
  const unlockedFromProfile = use$(store$.profile.unlockedThemes) ?? []
  const [editorOpen, setEditorOpen] = useState(false)
  const [confirmingTheme, setConfirmingTheme] = useState<ThemeName | null>(null)

  const router = useRouter()

  const tier: SubscriptionTier = getThemePickerTier()

  // Tokens earned minus tokens already spent
  const availableTokens = Math.max(
    0,
    (streak?.unlockTokensEarned ?? 0) - unlockedFromProfile.length
  )

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
        <View key={name}>
          <ThemeRow
            name={name}
            isSelected={currentTheme === name}
            isLocked={isLocked}
            lockedAffordance={lockedAffordance}
            onSelect={() => setTheme(name)}
            onLockedTap={handleLockedTap}
          />
          {confirmingTheme === name && (
            <View
              role="group"
              aria-label={`Unlock ${THEME_LABELS[name]}?`}
              className="pl-6 gap-2 pt-2"
            >
              <Text className="font-body text-[13px] text-color8">
                Unlock {THEME_LABELS[name]}?
              </Text>
              <View className="flex-row gap-3">
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
              </View>
            </View>
          )}
        </View>
      )
    })

  return (
    <View className="gap-3">
      {/* "Unlock everything now" — free tier only. Routes to the purchase surface. */}
      {tier === 'free' && (
        <ExpandingLineButton
          onPress={() => {
            router.push('/paid')
          }}
        >
          Unlock everything now
        </ExpandingLineButton>
      )}

      {renderThemeRows(LIGHT_THEMES)}

      <View className="h-[16px]" />

      {renderThemeRows(DARK_THEMES)}

      <View className="h-[16px]" />

      {/* Custom Theme Row — unchanged; no unlock-token model applies to custom themes */}
      {customTheme ? (
        <View
          testID={`theme-option-custom${isCustomSelected ? '-selected' : ''}`}
          className="flex-row items-center gap-3 cursor-pointer hover:opacity-80 press:opacity-70"
          onPress={() => setTheme('custom')}
        >
          <View
            className="size-[12px] rounded-[9999px] border border-color5"
            style={{ backgroundColor: customTheme.bg }}
          />
          <Text
            className={`flex-1 font-journal text-[20px] ${isCustomSelected ? 'text-color' : 'text-color8'} web:hover:text-color`}
          >
            My Theme
          </Text>
          <Text
            testID="edit-custom-theme"
            className="font-body text-[13px] text-color8 web:hover:text-color native:press:opacity-70 cursor-pointer"
            onPress={(e: any) => {
              e.stopPropagation?.()
              setEditorOpen(true)
            }}
          >
            Edit
          </Text>
        </View>
      ) : (
        <View
          testID="create-custom-theme"
          className="flex-row items-center gap-3 cursor-pointer hover:opacity-80 press:opacity-70"
          onPress={() => setEditorOpen(true)}
        >
          <View className="size-[12px] rounded-[9999px] border border-dashed border-color5" />
          <Text className="font-journal text-[20px] text-color8 web:hover:text-color">
            Create Custom Theme
          </Text>
        </View>
      )}

      {editorOpen && <CustomThemeEditor onClose={() => setEditorOpen(false)} />}
    </View>
  )
}
