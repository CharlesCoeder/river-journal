import { createThemes } from '@tamagui/theme-builder'
import { palettes } from './theme-palettes'

// Create all our themes using createThemes
// This will generate:
// 1. Light and dark base themes
// 2. Color variants for each (light_red, dark_blue, etc.)
export const themes = createThemes({
  // Base theme configuration - light and dark
  base: {
    palette: {
      light: palettes.light.base,
      dark: palettes.dark.base,
    },
  },

  // Color theme variants as children of the base light/dark themes
  childrenThemes: {
    // Red variant
    red: {
      palette: {
        light: palettes.light.red,
        dark: palettes.dark.red,
      },
    },

    // Blue variant
    blue: {
      palette: {
        light: palettes.light.blue,
        dark: palettes.dark.blue,
      },
    },

    // Green variant
    green: {
      palette: {
        light: palettes.light.green,
        dark: palettes.dark.green,
      },
    },
  },
})
