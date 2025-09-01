import { XStack, YStack, Circle, Button } from 'tamagui'
import { use$ } from '@legendapp/state/react'
import {
  theme$,
  setColorTheme,
  setBaseTheme,
  DEFAULT_COLOR_THEMES,
  type ColorThemeName,
} from 'app/state/theme'

const themes = DEFAULT_COLOR_THEMES.map(
  (themeName) =>
    ({
      name: themeName,
      color: themeName,
    }) as const
)

interface ThemeSwitcherProps {}

export const ThemeSwitcher = function ThemeSwitcher(_props: ThemeSwitcherProps) {
  const currentColorTheme = use$(theme$.colorTheme)
  const currentBaseTheme = use$(theme$.baseTheme)

  const handleThemeChange = (theme: ColorThemeName) => {
    setColorTheme(theme)
  }

  return (
    <YStack gap="$3" alignItems="flex-start" maxWidth="100%">
      <XStack gap="$2" alignItems="center" flexWrap="wrap">
        {themes.map((theme) => (
          <Circle
            key={theme.name}
            size="$2"
            $md={{ size: '$3' }}
            backgroundColor={theme.color}
            borderWidth={currentColorTheme === theme.name ? 3 : 1}
            borderColor={currentColorTheme === theme.name ? '$borderColor' : 'gray'}
            pressStyle={{
              scale: 0.9,
              borderColor: '$borderColor',
            }}
            hoverStyle={{
              scale: 1.1,
              borderColor: '$borderColor',
            }}
            cursor="pointer"
            onPress={() => handleThemeChange(theme.name)}
          />
        ))}
      </XStack>
      <Button onPress={() => setBaseTheme(currentBaseTheme === 'light' ? 'dark' : 'light')}>
        {currentBaseTheme === 'light' ? '☀️' : '🌙'} {currentBaseTheme}
      </Button>
    </YStack>
  )
}

export type { ColorThemeName }
