import { defaultConfig } from '@tamagui/config/v5'
import { createTamagui, type TamaguiInternalConfig } from 'tamagui'
import { fonts } from './fonts'
import { animations } from './animations'
import { themes } from './themes'

// Tamagui's `InferTamaguiConfig` conditional collapses to `unknown` whenever the
// argument is built with an object spread (`{ ...defaultConfig }`) — a known
// limitation of its generic inference in this version. That makes `typeof config`
// `unknown`, which breaks the `TamaguiCustomConfig` augmentation (TS2312) and
// every consumer of `config` (the providers see `unknown`). Cast the result to
// the concrete `TamaguiInternalConfig` (its generic params all default to the
// Generic* shapes the provider expects). This does not change runtime behavior;
// it only restores a usable static type.
export const config = createTamagui({
  ...defaultConfig,
  themes,
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
    // The frozen v5 pack defaults to 'web' in Tamagui 3, which changes how flex
    // resolves. Every layout in this app was built against 'react-native'.
    styleCompat: 'react-native',
  },
  animations,
  fonts,
  fontLanguages: ['classic', 'clean'] as const,
}) as unknown as TamaguiInternalConfig

export type Conf = typeof config

declare module '@tamagui/web/types/types' {
  interface TamaguiCustomConfig extends Conf {}
}
