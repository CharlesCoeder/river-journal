import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
import { bodyFont, headingFont } from './fonts'
import { animations } from './animations'
import { media, mediaQueryDefaultActive } from './media'

// TEMPORARY: Custom theme additions for missing colors - using light, subtle theme style
const customThemes = {
  orange: {
    ...defaultConfig.themes.light,
    background: '#fef2e6',
    backgroundHover: '#fed7aa',
    backgroundPress: '#fdba74',
    backgroundFocus: '#f97316',
    color: '#9a3412',
    colorHover: '#7c2d12',
    colorPress: '#ea580c',
    colorFocus: '#c2410c',
  },
  indigo: {
    ...defaultConfig.themes.light,
    background: '#eef2ff',
    backgroundHover: '#e0e7ff',
    backgroundPress: '#c7d2fe',
    backgroundFocus: '#818cf8',
    color: '#3730a3',
    colorHover: '#312e81',
    colorPress: '#4338ca',
    colorFocus: '#4f46e5',
  },
  violet: {
    ...defaultConfig.themes.light,
    background: '#faf5ff',
    backgroundHover: '#f3e8ff',
    backgroundPress: '#e9d5ff',
    backgroundFocus: '#a855f7',
    color: '#6b21a8',
    colorHover: '#581c87',
    colorPress: '#7c3aed',
    colorFocus: '#8b5cf6',
  },
}

export const config = createTamagui({
  ...defaultConfig,
  themes: {
    ...defaultConfig.themes,
    ...customThemes,
  },
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
