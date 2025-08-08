export const breakpoints = {
  '2xl': 1536,
  xl: 1280,
  lg: 1024,
  md: 768,
  sm: 640,
  xs: 460,
  '2xs': 340,
}

export const media = {
  // Max-width queries (largest to smallest is fine for max-width)
  max2Xl: { maxWidth: breakpoints['2xl'] },
  maxXl: { maxWidth: breakpoints.xl },
  maxLg: { maxWidth: breakpoints.lg },
  maxMd: { maxWidth: breakpoints.md },
  maxSm: { maxWidth: breakpoints.sm },
  maxXs: { maxWidth: breakpoints.xs },
  max2xs: { maxWidth: breakpoints['2xs'] },
  // Min-width queries (SMALLEST TO LARGEST for proper cascade)
  '2xs': { minWidth: breakpoints['2xs'] },
  xs: { minWidth: breakpoints.xs },
  sm: { minWidth: breakpoints.sm },
  md: { minWidth: breakpoints.md },
  lg: { minWidth: breakpoints.lg },
  xl: { minWidth: breakpoints.xl },
  '2xl': { minWidth: breakpoints['2xl'] },
} as const

export const mediaQueryDefaultActive = {
  '2xs': true,
  xs: true,
  sm: false,
  md: false,
  lg: false,
  xl: false,
  '2xl': false,
}
