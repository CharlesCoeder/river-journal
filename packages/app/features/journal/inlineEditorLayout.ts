/**
 * Layout facts the inline writing surface and the persistent editor overlay
 * share, so the overlay can place its own controls against the home chrome
 * without a second measurement.
 */

/** The × (abandon the page) is offered while the page is at most this many words long. */
export const INLINE_CLOSE_WORD_LIMIT = 5

/** Breathing room between the top row and the expanded editor's first line. */
export const INLINE_EXPANDED_TOP_GAP = 4

/** Height of home's top row (streak chip ⟷ Menu), which the × replaces in writing mode. */
export const INLINE_TOP_ROW_HEIGHT = 44

/** How far the top row's controls overhang the content padding, so their 44pt boxes sit flush to the words. */
export const INLINE_TOP_ROW_CONTROL_OVERHANG = 12
