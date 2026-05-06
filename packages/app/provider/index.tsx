// === EAGER IMPORT — ORDER-CRITICAL ===
// mutations.ts MUST execute before <PersistQueryClientProvider> mounts so that
// setMutationDefaults() calls register at module-load time. See:
// state/collective/mutations.ts header comment. Any reorder is a regression.
// ====================================
import 'app/state/collective/mutations'
import { __collectiveMutationsLoadedAt } from 'app/state/collective/mutations'

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
import { FontLanguage } from 'tamagui'
import { addTheme, updateTheme } from '@tamagui/theme'
import {
  PersistQueryClientProvider,
  removeOldestQuery,
} from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ToastViewport } from './ToastViewport'
import { use$ } from '@legendapp/state/react'
import { store$, isDarkTheme, isDarkColor } from 'app/state/store'
import { queryClient, dehydrateOptions } from 'app/state/queryClient'
import { queryStorage } from 'app/state/queryStorage'
import { DEFAULT_THEME, DEFAULT_FONT_PAIRING } from 'app/state/types'
import type { FontPairingId } from 'app/state/types'
import { generatePalette } from '@my/config/src/themes'

const FONT_VARIANT_MAP = {
  'outfit-newsreader': 'default',
  'lato-lora': 'classic',
  'inter-source-serif': 'clean',
} as const

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

// Persister is constructed once at module load. `key` is namespaced separately
// from any Legend-State MMKV/IndexedDB keys (`'rj-tq-cache'`). `retry:
// removeOldestQuery` is the documented TanStack pattern for graceful
// degradation when the underlying storage rejects a write (e.g. quota
// exceeded) — without it, a single oversized cache entry silently kills all
// subsequent persistence writes for the rest of the session.
const persister = createAsyncStoragePersister({
  storage: queryStorage,
  key: 'rj-tq-cache',
  throttleTime: 1000,
  retry: removeOldestQuery,
})

export function Provider({
  children,
  ...rest
}: Omit<TamaguiProviderProps, 'config' | 'defaultTheme'>) {
  // Dev-only ordering witness: if the eager `import 'app/state/collective/mutations'`
  // didn't execute before this Provider closure ran, the sentinel timestamp
  // would still be undefined. This is the cheapest runtime guard against a
  // future refactor (or auto-formatter) accidentally moving the eager import
  // below the provider import. Production builds DCE this branch.
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof __collectiveMutationsLoadedAt !== 'number'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[rj-tq] mutations.ts side-effects did not run before Provider mounted — eager-import ordering is broken. See state/collective/mutations.ts header.'
    )
  }

  const themeName = use$(store$.profile.themeName) ?? DEFAULT_THEME
  const customTheme = use$(store$.profile.customTheme)
  const fontPairing = use$(store$.profile.fontPairing) ?? DEFAULT_FONT_PAIRING
  const fontVariant = FONT_VARIANT_MAP[fontPairing] ?? 'default'
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
        <FontLanguage body={fontVariant} heading={fontVariant} journal={fontVariant} journalItalic={fontVariant}>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister,
              dehydrateOptions,
              maxAge: 24 * 60 * 60 * 1000,
            }}
            onSuccess={() => {
              queryClient.resumePausedMutations()
            }}
          >
            <ToastProvider
              swipeDirection="horizontal"
              duration={6000}
              native={isWeb ? [] : ['mobile']}
            >
              {children}
              <CustomToast />
              <ToastViewport />
            </ToastProvider>
            {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
          </PersistQueryClientProvider>
        </FontLanguage>
      </Theme>
    </TamaguiProvider>
  )
}
