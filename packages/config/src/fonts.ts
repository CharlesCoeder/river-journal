import { createInterFont } from '@tamagui/font-inter'
import { isWeb } from '@my/ui'
import { createGenericFont } from '@tamagui/config'

const letterSpacing = {
  1: 0,
  2: -0.5,
  3: -1,
  4: 0,
}

const weight = {
  1: '300',
  4: '400',
  6: '600',
  7: '700',
}

// NOTE: createGenericFont is a Tamagui helper used to help with line height on mobile. 
// They ought to put it in their docs, instead of recommending createFont().

const sourceSans3Font = createGenericFont(
  isWeb ? 'SourceSans3, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'SourceSans3',
  {
    weight,
    letterSpacing,
    face: {
      '300': { normal: 'SourceSans3', italic: 'SourceSans3Italic' },
      '400': { normal: 'SourceSans3', italic: 'SourceSans3Italic' },
      '600': { normal: 'SourceSans3Bold' },
      '700': { normal: 'SourceSans3Bold', italic: 'SourceSans3BoldItalic' },
    },
  },
  {
    sizeLineHeight: (size) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
  }
)

const sourceSans3ItalicFont = createGenericFont(
  isWeb ? 'SourceSans3, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'SourceSans3',
  {
    weight,
    letterSpacing,
    face: {
      '300': { normal: 'SourceSans3Italic' },
      '400': { normal: 'SourceSans3Italic' },
      '600': { normal: 'SourceSans3BoldItalic' },
      '700': { normal: 'SourceSans3BoldItalic' },
    },
  },
  {
    sizeLineHeight: (size) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
  }
)

const sourceSans3BoldFont = createGenericFont(
  isWeb ? 'SourceSans3, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'SourceSans3',
  {
    weight,
    letterSpacing,
    face: {
      '300': { normal: 'SourceSans3Bold' },
      '400': { normal: 'SourceSans3Bold' },
      '600': { normal: 'SourceSans3Bold' },
      '700': { normal: 'SourceSans3Bold' },
    },
  },
  {
    sizeLineHeight: (size) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
  }
)

const sourceSans3BoldItalicFont = createGenericFont(
  isWeb ? 'SourceSans3, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'SourceSans3',
  {
    weight,
    letterSpacing,
    face: {
      '300': { normal: 'SourceSans3BoldItalic' },
      '400': { normal: 'SourceSans3BoldItalic' },
      '600': { normal: 'SourceSans3BoldItalic' },
      '700': { normal: 'SourceSans3BoldItalic' },
    },
  },
  {
    sizeLineHeight: (size) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
  }
)

const patrickHandFont = createGenericFont(
  'PatrickHand',
  {
    weight: { 1: '400', 4: '400' },
    letterSpacing: { 1: 0.5, 2: 0, 3: -0.5, 4: 0 },
  },
  {
    sizeLineHeight: (size) => Math.round(size * 1.5 + (size >= 12 ? 8 : 6)),
  }
)

export const interHeadingFont = createInterFont({
  size: {
    6: 15,
  },
  transform: {
    6: 'uppercase',
    7: 'none',
  },
  weight: {
    6: '400',
    7: '700',
  },
  color: {
    6: '$colorFocus',
    7: '$color',
  },
  letterSpacing: {
    5: 2,
    6: 1,
    7: 0,
    8: -1,
    9: -2,
    10: -3,
    12: -4,
    14: -5,
    15: -6,
  },
  face: {
    700: { normal: 'InterBold' },
  },
})

export const interBodyFont = createInterFont(
  {
    face: {
      700: { normal: 'InterBold' },
    },
  },
  {
    sizeSize: (size) => Math.round(size * 1.1),
    sizeLineHeight: (size) => Math.round(size * 1.1 + (size > 20 ? 10 : 10)),
  }
)

export const fonts = {
  // Default heading and body fonts: Inter (came from Tamagui starter)
  heading: interHeadingFont,
  body: interBodyFont,

  // Source Sans 3 fonts
  sourceSans3: sourceSans3Font,
  sourceSans3Italic: sourceSans3ItalicFont,
  sourceSans3Bold: sourceSans3BoldFont,
  sourceSans3BoldItalic: sourceSans3BoldItalicFont,

  // Patrick Hand font
  patrickHand: patrickHandFont,
}
