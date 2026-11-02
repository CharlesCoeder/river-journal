import { createFont, type GenericFont } from 'tamagui'

const isWeb = typeof window !== 'undefined'

// Tamagui 3 no longer exports createGenericFont, and its createSystemFont has
// different defaults. This keeps the size scale and defaults every font below
// was tuned against.
const genericFontSizes = {
  1: 10,
  2: 11,
  3: 12,
  4: 14,
  5: 15,
  6: 16,
  7: 20,
  8: 22,
  9: 30,
  10: 42,
  11: 52,
  12: 62,
  13: 72,
  14: 92,
  15: 114,
  16: 124,
} as const

function createGenericFont<A extends GenericFont<keyof typeof genericFontSizes>>(
  family: string,
  font: Partial<A> = {},
  {
    sizeLineHeight = (val) => val * 1.35,
  }: {
    sizeLineHeight?: (val: number) => number
  } = {}
): A {
  const size = font.size || genericFontSizes
  return createFont({
    family,
    size,
    lineHeight: Object.fromEntries(
      Object.entries(size).map(([k, v]) => [k, sizeLineHeight(+v)])
    ) as typeof size,
    weight: { 0: '300' },
    letterSpacing: { 4: 0 },
    ...(font as any),
  })
}

const sansLetterSpacing = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
}

const serifLetterSpacing = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
}

const sansWeight = {
  4: '400',
  5: '500',
}

const serifWeight = {
  4: '400',
  5: '500',
}

const sansLineHeight = {
  sizeLineHeight: (size: number) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
}
const serifLineHeight = {
  sizeLineHeight: (size: number) => Math.round(size * 1.5 + (size >= 12 ? 8 : 6)),
}

// =================================================================
// Default pairing: Outfit + Newsreader
// =================================================================

const outfitFont = createGenericFont(
  isWeb ? 'Outfit, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'Outfit',
  {
    weight: sansWeight,
    letterSpacing: sansLetterSpacing,
    face: {
      '400': { normal: 'Outfit' },
      '500': { normal: 'Outfit-Medium' },
    },
  },
  sansLineHeight
)

const newsreaderFont = createGenericFont(
  isWeb ? 'Newsreader, Georgia, "Times New Roman", serif' : 'Newsreader',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'Newsreader', italic: 'Newsreader-Italic' },
      '500': { normal: 'Newsreader-Medium', italic: 'Newsreader-Italic' },
    },
  },
  serifLineHeight
)

const newsreaderItalicFont = createGenericFont(
  isWeb ? 'Newsreader, Georgia, "Times New Roman", serif' : 'Newsreader',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'Newsreader-Italic' },
      '500': { normal: 'Newsreader-Italic' },
    },
  },
  serifLineHeight
)

// =================================================================
// Classic pairing: Lato + Lora
// =================================================================

const latoFont = createGenericFont(
  isWeb ? 'Lato, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'Lato',
  {
    weight: sansWeight,
    letterSpacing: sansLetterSpacing,
    face: {
      '400': { normal: 'Lato' },
      '500': { normal: 'Lato-Bold' },
    },
  },
  sansLineHeight
)

const loraFont = createGenericFont(
  isWeb ? 'Lora, Georgia, "Times New Roman", serif' : 'Lora',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'Lora', italic: 'Lora-Italic' },
      '500': { normal: 'Lora', italic: 'Lora-Italic' },
    },
  },
  serifLineHeight
)

const loraItalicFont = createGenericFont(
  isWeb ? 'Lora, Georgia, "Times New Roman", serif' : 'Lora',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'Lora-Italic' },
      '500': { normal: 'Lora-Italic' },
    },
  },
  serifLineHeight
)

// =================================================================
// Clean pairing: Inter + Source Serif 4
// =================================================================

const interFont = createGenericFont(
  isWeb ? 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif' : 'Inter',
  {
    weight: sansWeight,
    letterSpacing: sansLetterSpacing,
    face: {
      '400': { normal: 'Inter' },
      '500': { normal: 'Inter-Medium' },
    },
  },
  sansLineHeight
)

const sourceSerifFont = createGenericFont(
  isWeb ? 'SourceSerif4, Georgia, "Times New Roman", serif' : 'SourceSerif4',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'SourceSerif4', italic: 'SourceSerif4-Italic' },
      '500': { normal: 'SourceSerif4-Medium', italic: 'SourceSerif4-Italic' },
    },
  },
  serifLineHeight
)

const sourceSerifItalicFont = createGenericFont(
  isWeb ? 'SourceSerif4, Georgia, "Times New Roman", serif' : 'SourceSerif4',
  {
    weight: serifWeight,
    letterSpacing: serifLetterSpacing,
    face: {
      '400': { normal: 'SourceSerif4-Italic' },
      '500': { normal: 'SourceSerif4-Italic' },
    },
  },
  serifLineHeight
)

// =================================================================
// Export: base fonts + FontLanguage variants (_classic, _clean)
// =================================================================

export const fonts = {
  // Base fonts (default pairing: Outfit + Newsreader)
  heading: outfitFont,
  body: outfitFont,
  journal: newsreaderFont,
  journalItalic: newsreaderItalicFont,
  // "classic" variant (Lato + Lora)
  body_classic: latoFont,
  heading_classic: latoFont,
  journal_classic: loraFont,
  journalItalic_classic: loraItalicFont,
  // "clean" variant (Inter + Source Serif 4)
  body_clean: interFont,
  heading_clean: interFont,
  journal_clean: sourceSerifFont,
  journalItalic_clean: sourceSerifItalicFont,
}
