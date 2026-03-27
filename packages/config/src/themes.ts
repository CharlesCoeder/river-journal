import { createThemes, defaultComponentThemes } from '@tamagui/theme-builder'

// -----------------------------------------------------------------
// Named theme palettes — 12-step gradient from bg → text
// "stone" (muted) lands at steps 6-7
// -----------------------------------------------------------------

type ThemeDef = { bg: string; text: string; stone: string; isDark: boolean }

const THEME_DEFS: Record<string, ThemeDef> = {
  ink: { bg: '#F9F6F0', text: '#2C2A28', stone: '#8A8680', isDark: false },
  'forest-morning': { bg: '#E8EDE4', text: '#2B3A30', stone: '#819183', isDark: false },
  leather: { bg: '#F0E7DA', text: '#4A3525', stone: '#9C8B81', isDark: false },
  night: { bg: '#1C1A18', text: '#E6E2DA', stone: '#8C8B85', isDark: true },
  'forest-night': { bg: '#1A221C', text: '#DCE3DD', stone: '#788C7D', isDark: true },
  fireside: { bg: '#2B1D14', text: '#E6DACB', stone: '#8A786B', isDark: true },
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function generatePalette(def: ThemeDef): string[] {
  const [r0, g0, b0] = hexToRgb(def.bg)
  const [r1, g1, b1] = hexToRgb(def.text)
  const palette: string[] = []
  for (let i = 0; i < 12; i++) {
    const t = i / 11
    palette.push(rgbToHex(lerp(r0, r1, t), lerp(g0, g1, t), lerp(b0, b1, t)))
  }
  return palette
}

// Build light and dark base palettes + named child themes
// The base palette is just "ink" (light default) and "night" (dark default)
const inkPalette = generatePalette(THEME_DEFS['ink']!)
const nightPalette = generatePalette(THEME_DEFS['night']!)

// Shadow tokens — kept minimal, flat design doesn't use them prominently
const lightShadows = {
  shadow1: 'rgba(0,0,0,0.04)',
  shadow2: 'rgba(0,0,0,0.08)',
  shadow3: 'rgba(0,0,0,0.16)',
  shadow4: 'rgba(0,0,0,0.24)',
  shadow5: 'rgba(0,0,0,0.32)',
  shadow6: 'rgba(0,0,0,0.4)',
  shadow7: 'rgba(0,0,0,0.5)',
  shadow8: 'rgba(0,0,0,0.6)',
  shadow9: 'rgba(0,0,0,0.7)',
  shadow10: 'rgba(0,0,0,0.8)',
}

const darkShadows = {
  shadow1: 'rgba(0,0,0,0.2)',
  shadow2: 'rgba(0,0,0,0.3)',
  shadow3: 'rgba(0,0,0,0.4)',
  shadow4: 'rgba(0,0,0,0.5)',
  shadow5: 'rgba(0,0,0,0.6)',
  shadow6: 'rgba(0,0,0,0.65)',
  shadow7: 'rgba(0,0,0,0.75)',
  shadow8: 'rgba(0,0,0,0.8)',
  shadow9: 'rgba(0,0,0,0.85)',
  shadow10: 'rgba(0,0,0,0.9)',
}

function paletteToColors(palette: string[], prefix: 'black' | 'white') {
  const out: Record<string, string> = {}
  palette.forEach((c, i) => {
    out[`${prefix}${i + 1}`] = c
  })
  return out
}

const blackColors = paletteToColors(nightPalette, 'black')
const whiteColors = paletteToColors(inkPalette, 'white')

const generatedThemes = createThemes({
  componentThemes: defaultComponentThemes,

  base: {
    palette: {
      light: inkPalette,
      dark: nightPalette,
    },
    extra: {
      light: {
        ...lightShadows,
        ...blackColors,
        ...whiteColors,
        shadowColor: lightShadows.shadow1,
        colorBg: THEME_DEFS['ink']!.bg,
      },
      dark: {
        ...darkShadows,
        ...blackColors,
        ...whiteColors,
        shadowColor: darkShadows.shadow1,
        colorBg: THEME_DEFS['night']!.bg,
      },
    },
  },

  childrenThemes: {
    ink: {
      palette: {
        light: generatePalette(THEME_DEFS['ink']!),
        dark: generatePalette(THEME_DEFS['ink']!),
      },
    },
    night: {
      palette: {
        dark: generatePalette(THEME_DEFS['night']!),
        light: generatePalette(THEME_DEFS['night']!),
      },
    },
    'forest-morning': {
      palette: {
        light: generatePalette(THEME_DEFS['forest-morning']!),
        dark: generatePalette(THEME_DEFS['forest-morning']!),
      },
    },
    'forest-night': {
      palette: {
        dark: generatePalette(THEME_DEFS['forest-night']!),
        light: generatePalette(THEME_DEFS['forest-night']!),
      },
    },
    leather: {
      palette: {
        light: generatePalette(THEME_DEFS['leather']!),
        dark: generatePalette(THEME_DEFS['leather']!),
      },
    },
    fireside: {
      palette: {
        dark: generatePalette(THEME_DEFS['fireside']!),
        light: generatePalette(THEME_DEFS['fireside']!),
      },
    },
  },

  grandChildrenThemes: {
    alt1: {
      template: 'alt1',
    },
    alt2: {
      template: 'alt2',
    },
    surface1: {
      template: 'surface1',
    },
    surface2: {
      template: 'surface2',
    },
    surface3: {
      template: 'surface3',
    },
  },
})

export type TamaguiThemes = typeof generatedThemes

export const themes: TamaguiThemes =
  process.env.TAMAGUI_ENVIRONMENT === 'client' && process.env.NODE_ENV === 'production'
    ? ({} as any)
    : (generatedThemes as any)

// Re-export theme definitions for UI (e.g. ThemePicker)
export { THEME_DEFS }
