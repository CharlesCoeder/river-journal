import { observable } from '@legendapp/state'

export type ColorThemeName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'indigo' | 'violet'

interface ThemeState {
  currentTheme: ColorThemeName
}

export const theme$ = observable<ThemeState>({
  currentTheme: 'blue', // Default theme
})

// Actions
export const setTheme = (themeName: ColorThemeName) => {
  theme$.currentTheme.set(themeName)
}

export const getCurrentTheme = () => theme$.currentTheme.get()
