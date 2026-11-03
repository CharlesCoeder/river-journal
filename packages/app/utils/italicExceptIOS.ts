/**
 * `fontStyle` for italic text. Web shows the italic.
 *
 * Native leaves it unset to keep iOS as it has always looked: packages/config's
 * fonts.ts gives native the web font stack, which iOS cannot resolve, so it falls
 * back to the system font. React Native used to ignore `fontStyle` there and now
 * slants it. Once native gets real font families, set the native value to 'italic'
 * too, so these headings pick up their italic faces. packages/ui has the same pair.
 */
export const webItalic = 'italic' as const
