'use client'

import '@tamagui/core/reset.css'
import '@tamagui/polyfill-dev'

import type { ReactNode } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { NextThemeProvider } from '@tamagui/next-theme'
import { config, useTheme } from '@my/ui'
import { Provider } from 'app/provider'
import { StyleSheet } from 'react-native'
import { useEffect } from 'react'

export const NextTamaguiProvider = ({ children }: { children: ReactNode }) => {
  useServerInsertedHTML(() => {
    // @ts-ignore
    const rnwStyle = StyleSheet.getSheet()
    return (
      <>
        <style
          dangerouslySetInnerHTML={{ __html: rnwStyle.textContent }}
          id={rnwStyle.id}
        />
        <style
          dangerouslySetInnerHTML={{
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
      </>
    )
  })

  return (
    <NextThemeProvider
      skipNextHead
      defaultTheme="light"
    >
      <Provider>
        <SetHTMLBackgroundColor />
        {children}
      </Provider>
    </NextThemeProvider>
  )
}

function SetHTMLBackgroundColor() {
  const theme = useTheme()

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const backgroundColor = theme.background?.val
      if (backgroundColor) {
        document.documentElement.style.backgroundColor = backgroundColor
        document.body.style.backgroundColor = backgroundColor
      }
    }
  }, [theme.background?.val])

  return null
}
