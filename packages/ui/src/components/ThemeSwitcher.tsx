import { XStack, Circle, Button } from '@my/ui'
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
    <XStack gap="$5">
      <Button onPress={() => setBaseTheme(currentBaseTheme === 'light' ? 'dark' : 'light')}>
        {currentBaseTheme === 'light' ? '☀️' : '🌙'} {currentBaseTheme}
      </Button>
      <XStack gap="$2" alignItems="center">
        {themes.map((theme) => (
          <Circle
            key={theme.name}
            size={32}
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
    </XStack>
  )
}

export type { ColorThemeName }
