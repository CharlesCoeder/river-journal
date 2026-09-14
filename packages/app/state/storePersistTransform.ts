/**
 * state/storePersistTransform.ts
 *
 * Persist transform for the core `store$` observable.
 *
 * `store$.views.*` are derived computeds attached in state/store.ts and
 * state/streak.ts. Once a computed has been read on a device, Legend-State
 * includes its current value in the root snapshot, so whole-store persistence
 * writes it to disk (IndexedDB on web, MMKV on native) alongside the real
 * state. On the next launch that snapshot is merged back over the live
 * computed, and the computed only re-evaluates when one of its inputs
 * changes — so a device that last opened on a day the streak was N keeps
 * showing N on a later day where nothing in entries/flows/grace-days moves
 * (e.g. an incremental sync that pulls no rows). Dropping `views` at the
 * persistence boundary keeps derived state derived.
 *
 * Load is the load-bearing half: it also heals devices that already carry a
 * stale `views` snapshot. Save is left untouched on purpose — Legend-State
 * applies persist `save` transforms per change path and re-derives the path
 * from the transformed object's keys, so returning an object with the path's
 * key removed corrupts the write. A `views` row that still reaches disk is
 * inert because load ignores it.
 */

/** Return a copy of a persisted `store$` snapshot with the derived `views` subtree removed. */
export function stripDerivedViews<T extends object>(value: T): Omit<T, 'views'> {
  if (value === null || typeof value !== 'object') return value
  if (!('views' in value)) return value
  const { views: _views, ...rest } = value as T & { views?: unknown }
  return rest
}

export const STORE_PERSIST_TRANSFORM = {
  load: stripDerivedViews,
} as const
