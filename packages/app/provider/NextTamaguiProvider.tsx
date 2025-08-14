'use client'

import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import '@tamagui/polyfill-dev'

import type { ReactNode } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { NextThemeProvider, useRootTheme } from '@tamagui/next-theme'
import { config, useTheme } from '@my/ui'
import { Provider } from 'app/provider'
import { StyleSheet } from 'react-native'
import { theme$, setBaseTheme } from 'app/state/theme'
import { use$ } from '@legendapp/state/react'
import { syncState } from '@legendapp/state'
import { useEffect, useState } from 'react'

const status$ = syncState(theme$)

export const NextTamaguiProvider = ({ children }: { children: ReactNode }) => {
  useServerInsertedHTML(() => {
    // @ts-ignore
    const rnwStyle = StyleSheet.getSheet()
    return (
      <>
        <link rel="stylesheet" href="/tamagui.css" />
        <style dangerouslySetInnerHTML={{ __html: rnwStyle.textContent }} id={rnwStyle.id} />
        <style
          dangerouslySetInnerHTML={{
            // the first time this runs you'll get the full CSS including all themes
            // after that, it will only return CSS generated since the last call
            __html: config.getNewCSS(),
          }}
        />

        <style
          dangerouslySetInnerHTML={{
            __html: config.getCSS({
              exclude: process.env.NODE_ENV === 'production' ? 'design-system' : null,
            }),
          }}
        />

        <script
          dangerouslySetInnerHTML={{
            // avoid flash of animated things on enter:
            __html: `document.documentElement.classList.add('t_unmounted')`,
          }}
        />
      </>
    )
  })

  return (
    <NextThemeProvider
      skipNextHead
      // investigate: using forceTheme={baseTheme} and onChangeTheme={setBaseTheme}
      // curious on if legend state persistence will negatively affect any SSR benefits of NextThemeProvider
      defaultTheme="light"
      onChangeTheme={(next) => {
        setBaseTheme(next as any)
      }}
    >
      <Provider>
        <SetHTMLBackgroundColor />
        {children}
      </Provider>
    </NextThemeProvider>
  )
}

// Component to sync HTML background color with Tamagui theme
function SetHTMLBackgroundColor() {
  const theme = useTheme()

  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Get the actual background color from the current Tamagui theme
      const backgroundColor = theme.background.val

      // Update the HTML element's background color
      document.documentElement.style.backgroundColor = backgroundColor
      document.body.style.backgroundColor = backgroundColor
    }
  }, [theme.background.val])

  return null
}
