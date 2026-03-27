import { Text, YStack } from 'tamagui'
import { use$ } from '@legendapp/state/react'
import { store$, setTheme } from 'app/state/store'
import type { ThemeName } from 'app/state/types'
import { THEME_NAMES } from 'app/state/types'

const THEME_LABELS: Record<ThemeName, string> = {
  ink: 'Ink & Paper',
  night: 'Night Study',
  'forest-morning': 'Forest Morning',
  'forest-night': 'Forest Night',
  leather: 'Worn Leather',
  fireside: 'Fireside',
}

export const ThemeSwitcher = function ThemeSwitcher() {
  const currentTheme = use$(store$.profile.themeName) ?? 'ink'

  return (
    <YStack gap="$3" alignItems="flex-start" maxWidth="100%">
      {THEME_NAMES.map((name) => (
        <Text
          key={name}
          fontFamily="$journal"
          fontSize={20}
          color={currentTheme === name ? '$color' : '$color8'}
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={() => setTheme(name)}
        >
          {THEME_LABELS[name]}
        </Text>
      ))}
    </YStack>
  )
}

export type { ThemeName }
