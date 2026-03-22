import * as Colors from '@tamagui/colors'
import { createThemes, defaultComponentThemes } from '@tamagui/theme-builder'
import { desaturate } from 'color2k'

const desat = (colors: Record<string, string>, amount: number) => {
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, desaturate(value, amount)])
  )
}

const colorsGreenDark = desat(Colors.greenDark, 0.2) as typeof Colors.greenDark
const colorsGreen = desat(Colors.green, 0.2) as typeof Colors.green

// Themes are from tamagui src

// Brand palettes — "Modern Sanctuary" aesthetic
// Light: warm cream #DCC7BE → dark text #232020
// Dark: deep warm black #232020 → light text #E0E0E0
const darkPalette = [
  '#232020', // background
  '#2C2826',
  '#363230',
  '#403C3A',
  '#4D4845',
  '#5A5451',
  '#6E6763',
  '#837B77',
  '#9E9590',
  '#B5ACA7',
  '#CCC3BE',
  '#E0E0E0', // foreground text
]

const lightPalette = [
  '#DCC7BE', // background — warm cream
  '#D4BDB3',
  '#CBB3A8',
  '#C2A99E',
  '#B89E93',
  '#AD9388',
  '#9A8278',
  '#877068',
  '#6B5850',
  '#504038',
  '#382C26',
  '#232020', // foreground text
]

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

const blackColors = {
  black1: darkPalette[0]!,
  black2: darkPalette[1]!,
  black3: darkPalette[2]!,
  black4: darkPalette[3]!,
  black5: darkPalette[4]!,
  black6: darkPalette[5]!,
  black7: darkPalette[6]!,
  black8: darkPalette[7]!,
  black9: darkPalette[8]!,
  black10: darkPalette[9]!,
  black11: darkPalette[10]!,
  black12: darkPalette[11]!,
}

const whiteColors = {
  white1: lightPalette[0]!,
  white2: lightPalette[1]!,
  white3: lightPalette[2]!,
  white4: lightPalette[3]!,
  white5: lightPalette[4]!,
  white6: lightPalette[5]!,
  white7: lightPalette[6]!,
  white8: lightPalette[7]!,
  white9: lightPalette[8]!,
  white10: lightPalette[9]!,
  white11: lightPalette[10]!,
  white12: lightPalette[11]!,
}

const generatedThemes = createThemes({
  componentThemes: defaultComponentThemes,

  base: {
    palette: {
      dark: darkPalette,
      light: lightPalette,
    },

    // for values we don't want being inherited onto sub-themes
    extra: {
      light: {
        ...Colors.blue,
        ...Colors.gray,
        ...colorsGreen,
        ...Colors.orange,
        ...Colors.pink,
        ...Colors.purple,
        ...Colors.red,
        ...Colors.yellow,
        ...lightShadows,
        ...blackColors,
        ...whiteColors,
        shadowColor: lightShadows.shadow1,
        colorBg: '#DCC7BE',
      },
      dark: {
        ...Colors.blueDark,
        ...Colors.grayDark,
        ...colorsGreenDark,
        ...Colors.orangeDark,
        ...Colors.pinkDark,
        ...Colors.purpleDark,
        ...Colors.redDark,
        ...Colors.yellowDark,
        ...darkShadows,
        ...blackColors,
        ...whiteColors,
        shadowColor: darkShadows.shadow1,
        colorBg: '#232020',
      },
    },
  },

  // inverse accent theme
  accent: {
    palette: {
      dark: lightPalette,
      light: darkPalette,
    },
  },

  childrenThemes: {
    black: {
      palette: {
        dark: Object.values(blackColors) as string[],
        light: Object.values(blackColors) as string[],
      },
    },
    white: {
      palette: {
        dark: Object.values(whiteColors) as string[],
        light: Object.values(whiteColors) as string[],
      },
    },
    gray: {
      palette: {
        dark: Object.values(Colors.grayDark),
        light: Object.values(Colors.gray),
      },
    },
    blue: {
      palette: {
        dark: Object.values(Colors.blueDark),
        light: Object.values(Colors.blue),
      },
    },
    orange: {
      palette: {
        dark: Object.values(Colors.orangeDark),
        light: Object.values(Colors.orange),
      },
    },
    red: {
      palette: {
        dark: Object.values(Colors.redDark),
        light: Object.values(Colors.red),
      },
    },
    yellow: {
      palette: {
        dark: Object.values(Colors.yellowDark),
        light: Object.values(Colors.yellow),
      },
    },
    green: {
      palette: {
        dark: Object.values(colorsGreenDark),
        light: Object.values(colorsGreen),
      },
    },
    purple: {
      palette: {
        dark: Object.values(Colors.purpleDark),
        light: Object.values(Colors.purple),
      },
    },
    pink: {
      palette: {
        dark: Object.values(Colors.pinkDark),
        light: Object.values(Colors.pink),
      },
    },
    tan: {
      palette: {
        light: [
          'hsla(40, 30%, 98%, 1)',
          'hsla(40, 24%, 94%, 1)',
          'hsla(38, 23%, 91%, 1)',
          'hsla(36, 20%, 90%, 1)',
          'hsla(36, 20%, 88%, 1)',
          'hsla(35, 20%, 85%, 1)',
          'hsla(35, 21%, 74%, 1)',
          'hsla(34, 20%, 70%, 1)',
          'hsla(35, 20%, 67%, 1)',
          'hsla(34, 19%, 47%, 1)',
          'hsla(35, 18%, 37%, 1)',
          'hsla(35, 17%, 20%, 1)',
        ],
        dark: [
          'hsla(30, 9%, 10%, 1)',
          'hsla(30, 10%, 12%, 1)',
          'hsla(31, 11%, 18%, 1)',
          'hsla(30, 12%, 23%, 1)',
          'hsla(30, 14%, 28%, 1)',
          'hsla(30, 16%, 33%, 1)',
          'hsla(30, 18%, 38%, 1)',
          'hsla(30, 20%, 45%, 1)',
          'hsla(30, 21%, 50%, 1)',
          'hsla(29, 22%, 58%, 1)',
          'hsla(34, 24%, 70%, 1)',
          'hsla(11, 12%, 79%, 1)',
        ],
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

/**
 * This is an optional production optimization: themes JS can get to 20Kb or more.
 * Tamagui has <1Kb of logic to hydrate themes from CSS, so you can remove the JS.
 * So long as you server render your Tamagui CSS, this will save you bundle size:
 */
export const themes: TamaguiThemes =
  process.env.TAMAGUI_ENVIRONMENT === 'client' && process.env.NODE_ENV === 'production'
    ? ({} as any)
    : (generatedThemes as any)
