import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
import { bodyFont, headingFont } from './fonts'
import { animations } from './animations'
import { media, mediaQueryDefaultActive } from './media'

export const config = createTamagui({
  ...defaultConfig,
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
    styleCompat: 'react-native',
    mediaQueryDefaultActive,
  },
  animations,
  fonts: {
    body: bodyFont,
    heading: headingFont,
  },
  media,
})
