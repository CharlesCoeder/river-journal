import { observable } from '@legendapp/state'
import { syncObservable } from '@legendapp/state/sync'
import { configurePersistence } from '../persistConfig'

export type BaseThemeName = 'light' | 'dark'

// Single source of truth for color theme names
export const DEFAULT_COLOR_THEMES = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'gray',
] as const

export type ColorThemeName = (typeof DEFAULT_COLOR_THEMES)[number]

interface ThemeState {
  baseTheme: BaseThemeName
  colorTheme: ColorThemeName
}

export const theme$ = observable<ThemeState>({
  baseTheme: 'light', // Default base
  colorTheme: 'blue', // Default color
})

// Only setup persistence on the client side
if (typeof window !== 'undefined') {
  try {
    syncObservable(
      theme$,
      configurePersistence({
        persist: {
          name: 'theme',
        },
      })
    )
  } catch (error) {
    console.error('Error setting up journal store persistence:', error)
  }
}
// Actions
export const setBaseTheme = (baseTheme: BaseThemeName) => {
  theme$.baseTheme.set(baseTheme)
}

export const setColorTheme = (themeName: ColorThemeName) => {
  theme$.colorTheme.set(themeName)
}

export const getCurrentBaseTheme = () => theme$.baseTheme.get()
export const getCurrentColorTheme = () => theme$.colorTheme.get()
