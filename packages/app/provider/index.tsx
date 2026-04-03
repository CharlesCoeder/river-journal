import { useLayoutEffect, useState } from 'react'
import {
  CustomToast,
  TamaguiProvider,
  type TamaguiProviderProps,
  Theme,
  ToastProvider,
  config,
  isWeb,
} from '@my/ui'
import { addTheme, updateTheme } from '@tamagui/theme'
import { ToastViewport } from './ToastViewport'
import { use$ } from '@legendapp/state/react'
import { store$, isDarkTheme, isDarkColor } from 'app/state/store'
import { DEFAULT_THEME } from 'app/state/types'
import { generatePalette } from '@my/config/src/themes'

function buildCustomThemeTokens(palette: string[]) {
  return {
    color1: palette[0],
    color2: palette[1],
    color3: palette[2],
    color4: palette[3],
    color5: palette[4],
    color6: palette[5],
    color7: palette[6],
    color8: palette[7],
    color9: palette[8],
    color10: palette[9],
    color11: palette[10],
    color12: palette[11],
    background: palette[0],
    backgroundHover: palette[1],
    backgroundPress: palette[2],
    backgroundFocus: palette[1],
    color: palette[11],
    colorHover: palette[10],
    colorPress: palette[9],
    colorFocus: palette[10],
    borderColor: palette[4],
    borderColorHover: palette[5],
    borderColorPress: palette[3],
    borderColorFocus: palette[5],
    placeholderColor: palette[6],
    shadowColor: palette[0],
  }
}

// Track whether the custom theme has been registered via addTheme
let customThemeRegistered = false

export function Provider({
  children,
  ...rest
}: Omit<TamaguiProviderProps, 'config' | 'defaultTheme'>) {
  const themeName = use$(store$.profile.themeName) ?? DEFAULT_THEME
  const customTheme = use$(store$.profile.customTheme)
  const baseTheme = isDarkTheme(themeName) ? 'dark' : 'light'
  const [customReady, setCustomReady] = useState(customThemeRegistered)

  // useLayoutEffect runs synchronously before paint — the browser never shows
  // the fallback theme. addTheme registers a fresh runtime theme (no build-time
  // placeholder needed), updateTheme patches it on subsequent color changes.
  useLayoutEffect(() => {
    if (customTheme) {
      const isDark = isDarkColor(customTheme.bg)
      const palette = generatePalette({ ...customTheme, isDark })
      const theme = buildCustomThemeTokens(palette)

      if (customThemeRegistered) {
        updateTheme({ name: 'custom', theme })
      } else {
        addTheme({ name: 'custom', insertCSS: true, theme })
        customThemeRegistered = true
      }
      setCustomReady(true)
    } else {
      setCustomReady(false)
    }
  }, [customTheme])

  const resolvedThemeName = themeName === 'custom' && !customReady ? DEFAULT_THEME : themeName

  return (
    <TamaguiProvider
      config={config}
      defaultTheme={baseTheme}
      {...rest}
    >
      <Theme name={resolvedThemeName}>
        <ToastProvider
          swipeDirection="horizontal"
          duration={6000}
          native={isWeb ? [] : ['mobile']}
        >
          {children}
          <CustomToast />
          <ToastViewport />
        </ToastProvider>
      </Theme>
    </TamaguiProvider>
  )
}
