import { useState } from 'react'
import { Circle, Text, XStack, YStack, View } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, setTheme } from 'app/state/store'
import { LIGHT_THEMES, DARK_THEMES } from 'app/state/types'
import type { ThemeName } from 'app/state/types'
import { THEME_DEFS } from '@my/config/src/themes'
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
  onSelect,
}: {
  name: ThemeName
  isSelected: boolean
  onSelect: () => void
}) {
  const def = THEME_DEFS[name]
  return (
    <XStack
      testID={`theme-option-${name}${isSelected ? '-selected' : ''}`}
      alignItems="center"
      gap="$3"
      cursor="pointer"
      onPress={onSelect}
      hoverStyle={{ opacity: 0.8 }}
      pressStyle={{ opacity: 0.7 }}
    >
      <Circle
        size={12}
        borderWidth={1}
        borderColor="$color5"
        backgroundColor={def?.bg ?? 'transparent'}
      />
      <Text
        fontFamily="$journal"
        fontSize={20}
        color={isSelected ? '$color' : '$color8'}
        hoverStyle={{ color: '$color' }}
      >
        {THEME_LABELS[name]}
      </Text>
    </XStack>
  )
}

export function ThemePicker() {
  const currentTheme = use$(store$.profile.themeName) ?? 'ink'
  const customTheme = use$(store$.profile.customTheme)
  const [editorOpen, setEditorOpen] = useState(false)

  const isCustomSelected = currentTheme === 'custom'

  return (
    <YStack gap="$3">
      {LIGHT_THEMES.map((name) => (
        <ThemeRow
          key={name}
          name={name}
          isSelected={currentTheme === name}
          onSelect={() => setTheme(name)}
        />
      ))}

      <View height={16} />

      {DARK_THEMES.map((name) => (
        <ThemeRow
          key={name}
          name={name}
          isSelected={currentTheme === name}
          onSelect={() => setTheme(name)}
        />
      ))}

      <View height={16} />

      {/* Custom Theme Row */}
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
            hoverStyle={{ color: '$color' }}
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
            hoverStyle={{ color: '$color' }}
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
            hoverStyle={{ color: '$color' }}
          >
            Create Custom Theme
          </Text>
        </XStack>
      )}

      {editorOpen && <CustomThemeEditor onClose={() => setEditorOpen(false)} />}
    </YStack>
  )
}
