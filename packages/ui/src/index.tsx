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
export * from './components/WordCounter'
export * from './components/JournalTextArea'
// Export only the component; ThemeSwitcher re-exports a `ThemeName` type that
// would collide with tamagui's `ThemeName` (already re-exported via `export *
// from 'tamagui'` above), producing an ambiguous-re-export error.
export { ThemeSwitcher } from './components/ThemeSwitcher'
export { useReducedMotion } from './hooks/useReducedMotion'
export * from './components/ThreePostureDisclosure'
export * from './components/AuthorByline'

// type augmentation for tamagui custom config
import type { Conf } from '@my/config'
declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}

// Web-only Tamagui props missing from the RN-typed component prop sets in this
// config. This augmentation lives here (rather than in a standalone .d.ts) so it
// propagates to every workspace that imports `@my/ui` — apps/web, apps/desktop,
// apps/mobile, and packages/app all pull it in transitively, the same way the
// TamaguiCustomConfig augmentation above does.
//
// `ExtendBaseStackProps` / `ExtendBaseTextProps` are empty interfaces Tamagui
// declares in `@tamagui/web` expressly as augmentation hooks; both feed into the
// Stack and Text prop sets (including pseudo/media sub-styles). Every prop below
// is valid at Tamagui runtime — this only aligns the static types.
declare module '@tamagui/web' {
  interface ExtendBaseStackProps {
    // `tag` renders a component as a specific HTML element on web (ul/li/article).
    tag?: string
    // `animation` selects an animation config key; the generic config type does
    // not surface the keys, so declare it explicitly.
    animation?: string
    // Tamagui Buttons (and other Stack-framed components) forward font props to
    // their inner Text at runtime; the Stack-based prop type omits them.
    fontFamily?: string
    fontSize?: string | number
    lineHeight?: string | number
    textAlignVertical?: 'auto' | 'top' | 'bottom' | 'center'
    placeholderTextColor?: string
    // Hover events + web outline CSS props exist on the web build but are absent
    // from the RN-typed view props in this config.
    onHoverIn?: (event: unknown) => void
    onHoverOut?: (event: unknown) => void
    outlineWidth?: string | number
    outlineStyle?: string
    outlineColor?: string
    // Passthrough web data-* attributes used for test hooks / styling state.
    [key: `data-${string}`]: string | number | boolean | undefined
  }
  interface ExtendBaseTextProps {
    tag?: string
    animation?: string
    // `href` renders a Text as an anchor on web (used by nav links).
    href?: string
    [key: `data-${string}`]: string | number | boolean | undefined
  }
}
