import { colorTokens } from './tokens'

// Convert our token objects into arrays for createThemes
// Each palette should be an array from background (subtle) to foreground (prominent)

// Base light and dark palettes (grayscale)
export const lightPalette = [
  colorTokens.gray[0], // 0: Most subtle background
  colorTokens.gray[1], // 1
  colorTokens.gray[2], // 2
  colorTokens.gray[3], // 3
  colorTokens.gray[4], // 4
  colorTokens.gray[5], // 5
  colorTokens.gray[6], // 6
  colorTokens.gray[7], // 7
  colorTokens.gray[8], // 8
  colorTokens.gray[9], // 9
  colorTokens.gray[10], // 10
  colorTokens.gray[11], // 11: Most prominent foreground
]

export const darkPalette = [
  colorTokens.grayDark[0], // 0: Most subtle background
  colorTokens.grayDark[1], // 1
  colorTokens.grayDark[2], // 2
  colorTokens.grayDark[3], // 3
  colorTokens.grayDark[4], // 4
  colorTokens.grayDark[5], // 5
  colorTokens.grayDark[6], // 6
  colorTokens.grayDark[7], // 7
  colorTokens.grayDark[8], // 8
  colorTokens.grayDark[9], // 9
  colorTokens.grayDark[10], // 10
  colorTokens.grayDark[11], // 11: Most prominent foreground
]

// Red theme palettes
export const redLightPalette = [
  colorTokens.red[0], // 0: Most subtle background
  colorTokens.red[1], // 1
  colorTokens.red[2], // 2
  colorTokens.red[3], // 3
  colorTokens.red[4], // 4
  colorTokens.red[5], // 5
  colorTokens.red[6], // 6
  colorTokens.red[7], // 7
  colorTokens.red[8], // 8
  colorTokens.red[9], // 9
  colorTokens.red[10], // 10
  colorTokens.red[11], // 11: Most prominent foreground
]

export const redDarkPalette = [
  colorTokens.redDark[0], // 0: Most subtle background
  colorTokens.redDark[1], // 1
  colorTokens.redDark[2], // 2
  colorTokens.redDark[3], // 3
  colorTokens.redDark[4], // 4
  colorTokens.redDark[5], // 5
  colorTokens.redDark[6], // 6
  colorTokens.redDark[7], // 7
  colorTokens.redDark[8], // 8
  colorTokens.redDark[9], // 9
  colorTokens.redDark[10], // 10
  colorTokens.redDark[11], // 11: Most prominent foreground
]

// Blue theme palettes
export const blueLightPalette = [
  colorTokens.blue[0], // 0: Most subtle background
  colorTokens.blue[1], // 1
  colorTokens.blue[2], // 2
  colorTokens.blue[3], // 3
  colorTokens.blue[4], // 4
  colorTokens.blue[5], // 5
  colorTokens.blue[6], // 6
  colorTokens.blue[7], // 7
  colorTokens.blue[8], // 8
  colorTokens.blue[9], // 9
  colorTokens.blue[10], // 10
  colorTokens.blue[11], // 11: Most prominent foreground
]

export const blueDarkPalette = [
  colorTokens.blueDark[0], // 0: Most subtle background
  colorTokens.blueDark[1], // 1
  colorTokens.blueDark[2], // 2
  colorTokens.blueDark[3], // 3
  colorTokens.blueDark[4], // 4
  colorTokens.blueDark[5], // 5
  colorTokens.blueDark[6], // 6
  colorTokens.blueDark[7], // 7
  colorTokens.blueDark[8], // 8
  colorTokens.blueDark[9], // 9
  colorTokens.blueDark[10], // 10
  colorTokens.blueDark[11], // 11: Most prominent foreground
]

// Green theme palettes
export const greenLightPalette = [
  colorTokens.green[0], // 0: Most subtle background
  colorTokens.green[1], // 1
  colorTokens.green[2], // 2
  colorTokens.green[3], // 3
  colorTokens.green[4], // 4
  colorTokens.green[5], // 5
  colorTokens.green[6], // 6
  colorTokens.green[7], // 7
  colorTokens.green[8], // 8
  colorTokens.green[9], // 9
  colorTokens.green[10], // 10
  colorTokens.green[11], // 11: Most prominent foreground
]

export const greenDarkPalette = [
  colorTokens.greenDark[0], // 0: Most subtle background
  colorTokens.greenDark[1], // 1
  colorTokens.greenDark[2], // 2
  colorTokens.greenDark[3], // 3
  colorTokens.greenDark[4], // 4
  colorTokens.greenDark[5], // 5
  colorTokens.greenDark[6], // 6
  colorTokens.greenDark[7], // 7
  colorTokens.greenDark[8], // 8
  colorTokens.greenDark[9], // 9
  colorTokens.greenDark[10], // 10
  colorTokens.greenDark[11], // 11: Most prominent foreground
]

// Export all palettes grouped for createThemes
export const palettes = {
  light: {
    base: lightPalette,
    red: redLightPalette,
    blue: blueLightPalette,
    green: greenLightPalette,
  },
  dark: {
    base: darkPalette,
    red: redDarkPalette,
    blue: blueDarkPalette,
    green: greenDarkPalette,
  },
}
