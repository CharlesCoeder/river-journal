/**
 * `fontStyle` for italic text. Web and Android show the italic.
 *
 * iOS leaves it unset to keep the look it has always had: packages/config's
 * fonts.ts gives native the web font stack, which iOS cannot resolve, so it falls
 * back to the system font. React Native on iOS used to ignore `fontStyle` there and
 * now slants it. Android always slanted it. Once native gets real font families,
 * delete the .ios file so these headings pick up their italic faces.
 * packages/ui has the same pair.
 */
export const italicExceptIOS = 'italic' as const
