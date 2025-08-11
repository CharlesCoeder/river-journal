import { XStack, Circle, Button } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { theme$, setColorTheme, setBaseTheme } from 'app/state/theme'

const themes = [
  { name: 'red', color: 'red' },
  { name: 'orange', color: 'orange' },
  { name: 'yellow', color: 'yellow' },
  { name: 'green', color: 'green' },
  { name: 'blue', color: 'blue' },
  { name: 'indigo', color: 'indigo' },
  { name: 'violet', color: 'violet' },
] as const

type ColorThemeName = (typeof themes)[number]['name']

interface ThemeSwitcherProps {
}

export const ThemeSwitcher = function ThemeSwitcher({
}: ThemeSwitcherProps) {
  const currentColorTheme = use$(theme$.colorTheme)
  const currentBaseTheme = use$(theme$.baseTheme)

  const handleThemeChange = (theme: ColorThemeName) => {
    setColorTheme(theme)
  }

  return (
    <XStack gap="$5">
      <Button
        onPress={() => setBaseTheme(currentBaseTheme === 'light' ? 'dark' : 'light')}
      >
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
      ))}</XStack>

    </XStack>
  )
}

export type { ColorThemeName }
