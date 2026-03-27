import { createGenericFont } from '@tamagui/config'

const isWeb = typeof window !== 'undefined'

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

// Outfit — UI / heading sans-serif
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
  {
    sizeLineHeight: (size) => Math.round(size * 1.4 + (size >= 12 ? 6 : 4)),
  }
)

// Newsreader — journal / content serif
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
  {
    sizeLineHeight: (size) => Math.round(size * 1.5 + (size >= 12 ? 8 : 6)),
  }
)

// Newsreader italic variant (for $journalItalic)
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
  {
    sizeLineHeight: (size) => Math.round(size * 1.5 + (size >= 12 ? 8 : 6)),
  }
)

export const fonts = {
  heading: outfitFont,
  body: outfitFont,
  journal: newsreaderFont,
  journalItalic: newsreaderItalicFont,
}
