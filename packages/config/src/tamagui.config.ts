import { defaultConfig } from '@tamagui/config/v5'
import { createTamagui } from 'tamagui'
import { fonts } from './fonts'
import { animations } from './animations'
import { themes } from './themes'

export const config = createTamagui({
  ...defaultConfig,
  themes,
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
  },
  animations,
  fonts,
  fontLanguages: ['classic', 'clean'] as const,
})

export type Conf = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
