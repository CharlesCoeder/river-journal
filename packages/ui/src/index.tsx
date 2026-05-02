export * from 'tamagui'
export * from '@tamagui/toast'
export * from './MyComponent'
export { config, type Conf } from '@my/config'
export * from './CustomToast'
export * from './SwitchThemeButton'
export * from './components/ExpandingLineButton'
export * from './components/StreakChip'
export * from './components/CollectiveEntry'
export * from './components/WordCountDisplay'
export * from './components/JournalTextArea'
export * from './components/ThemeSwitcher'
export { useReducedMotion } from './hooks/useReducedMotion'

// type augmentation for tamagui custom config
import type { Conf } from '@my/config'
declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
