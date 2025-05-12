import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
import { bodyFont, headingFont } from './fonts'
import { animations } from './animations'
import { tokens } from './tokens'
import { themes } from './themes'

export const config = createTamagui({
  ...defaultConfig,
  animations,
  tokens,
  themes,
  fonts: {
    body: bodyFont,
    heading: headingFont,
  },
})
