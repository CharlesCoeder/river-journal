import { XStack, Circle, Theme } from '@my/ui'
import { observer, useObservable } from '@legendapp/state/react'

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
  currentTheme: ColorThemeName
  onThemeChange: (theme: ColorThemeName) => void
}

export const ThemeSwitcher = observer(function ThemeSwitcher({
  currentTheme,
  onThemeChange,
}: ThemeSwitcherProps) {
  return (
    <XStack gap="$2" alignItems="center">
      {themes.map((theme) => (
        <Circle
          key={theme.name}
          size={32}
          backgroundColor={theme.color}
          borderWidth={currentTheme === theme.name ? 3 : 1}
          borderColor={currentTheme === theme.name ? '$borderColor' : 'gray'}
          pressStyle={{
            scale: 0.9,
            borderColor: '$borderColor',
          }}
          hoverStyle={{
            scale: 1.1,
            borderColor: '$borderColor',
          }}
          cursor="pointer"
          onPress={() => onThemeChange(theme.name)}
        />
      ))}
    </XStack>
  )
})

export type { ColorThemeName }
