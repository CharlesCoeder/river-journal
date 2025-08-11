import { observable } from '@legendapp/state'

export type BaseThemeName = 'light' | 'dark'
export type ColorThemeName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'indigo' | 'violet'

interface ThemeState {
  baseTheme: BaseThemeName
  colorTheme: ColorThemeName
}

export const theme$ = observable<ThemeState>({
  baseTheme: 'light', // Default base
  colorTheme: 'blue', // Default color
})

// Actions
export const setBaseTheme = (baseTheme: BaseThemeName) => {
  theme$.baseTheme.set(baseTheme)
}

export const setColorTheme = (themeName: ColorThemeName) => {
  theme$.colorTheme.set(themeName)
}

export const getCurrentBaseTheme = () => theme$.baseTheme.get()
export const getCurrentColorTheme = () => theme$.colorTheme.get()
