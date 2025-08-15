import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
import { fonts } from './fonts'
import { animations } from './animations'
import { media, mediaQueryDefaultActive } from './media'
import { themes } from './themes'

export const config = createTamagui({
  ...defaultConfig,
  themes,
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
    styleCompat: 'react-native',
    mediaQueryDefaultActive,
  },
  animations,
  fonts,
  media,
})
