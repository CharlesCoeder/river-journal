import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
import { bodyFont, headingFont } from './fonts'
import { animations } from './animations'
import { tokens } from './tokens'

export const config = createTamagui({
  ...defaultConfig,
  animations,
  tokens,
  fonts: {
    body: bodyFont,
    heading: headingFont,
  },
})
