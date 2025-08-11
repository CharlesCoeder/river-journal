'use client'

import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import '@tamagui/polyfill-dev'

import type { ReactNode } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { NextThemeProvider, useRootTheme } from '@tamagui/next-theme'
import { config } from '@my/ui'
import { Provider } from 'app/provider'
import { StyleSheet } from 'react-native'
import { theme$, setBaseTheme } from 'app/state/theme'
import { use$ } from '@legendapp/state/react'
import { syncState, when } from '@legendapp/state'
import { useEffect, useState } from 'react'

const status$ = syncState(theme$)

export const NextTamaguiProvider = ({ children }: { children: ReactNode }) => {
  const baseTheme = use$(theme$.baseTheme)
  const isPersistLoaded = use$(status$.isPersistLoaded)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

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

  // Show loading state until client has mounted and persistence has loaded
  if (!isMounted || !isPersistLoaded) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'Inter, sans-serif',
          fontSize: '16px',
          color: '#666',
        }}
      >
        Loading...
      </div>
    )
  }

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
      <Provider defaultTheme={baseTheme || 'light'}>{children}</Provider>
    </NextThemeProvider>
  )
}
