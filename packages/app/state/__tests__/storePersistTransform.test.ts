// @vitest-environment happy-dom
/**
 * storePersistTransform.test.ts — derived `store$.views` must never hydrate
 * from disk over the live computed.
 *
 * Regression for a production report: a device last opened on a day the
 * streak was legitimately 1 (a qualifying entry the day before, grace day
 * still open) kept showing "Day 1" on a later day where the correct answer
 * was 0. Whole-store persistence had written the activated `views.streak`
 * snapshot to disk; on the next launch it was merged back over the computed,
 * and with no input change afterwards (incremental sync pulled no rows) the
 * stale number stuck — across hard reloads and on every device.
 *
 * Exercises the real Legend-State hydration path (syncObservable + the
 * local-storage persist plugin) rather than a simulated `set`, because a
 * plain `set` onto an unactivated computed does NOT reproduce the clobber —
 * only the persistence merge does.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { observable, syncState, when } from '@legendapp/state'
import { syncObservable } from '@legendapp/state/sync'
import { ObservablePersistLocalStorage } from '@legendapp/state/persist-plugins/local-storage'
import { STORE_PERSIST_TRANSFORM, stripDerivedViews } from '../storePersistTransform'

const TABLE = 'app-state'

interface TestStore {
  session: { userId: string }
  profile: null
  views: { streak: { currentStreak: number } }
}

/** Build a store shaped like store$ with one derived view over `dep$`. */
function buildStore(dep$: ReturnType<typeof observable<number>>) {
  // Mirrors production: `views` is absent from the initial value and attached
  // afterwards as a computed (state/streak.ts does this via store$.assign).
  const store$ = observable<TestStore>({ session: { userId: 'u' }, profile: null } as TestStore)
  store$.assign({ views: { streak: () => ({ currentStreak: dep$.get() }) } } as any)
  return store$
}

describe('stripDerivedViews', () => {
  it('removes the views subtree and leaves real state intact', () => {
    const out = stripDerivedViews({
      session: { userId: 'u' },
      profile: { id: 'p' },
      views: { streak: { currentStreak: 1 } },
    })
    expect(out).toEqual({ session: { userId: 'u' }, profile: { id: 'p' } })
    expect('views' in out).toBe(false)
  })

  it('is a no-op for snapshots without views and for non-objects', () => {
    const plain = { session: { userId: 'u' } }
    expect(stripDerivedViews(plain)).toBe(plain)
    expect(stripDerivedViews(null as any)).toBeNull()
    expect(stripDerivedViews(undefined as any)).toBeUndefined()
  })
})

describe('store$ hydration vs derived views', () => {
  beforeEach(() => {
    localStorage.clear()
    // Yesterday's snapshot: the view was activated while the streak was 1.
    localStorage.setItem(
      TABLE,
      JSON.stringify({ session: { userId: 'u' }, views: { streak: { currentStreak: 1 } } })
    )
  })

  it('documents the failure mode: without the transform the stale snapshot wins', async () => {
    const dep$ = observable<number>(0)
    const store$ = buildStore(dep$)
    expect(store$.views.streak.get()).toEqual({ currentStreak: 0 })

    syncObservable(store$, { persist: { name: TABLE, plugin: ObservablePersistLocalStorage } })
    await when(syncState(store$).isPersistLoaded)

    expect(store$.views.streak.get()).toEqual({ currentStreak: 1 })
  })

  it('with the transform the live computed survives hydration', async () => {
    const dep$ = observable<number>(0)
    const store$ = buildStore(dep$)
    expect(store$.views.streak.get()).toEqual({ currentStreak: 0 })

    syncObservable(store$, {
      persist: {
        name: TABLE,
        plugin: ObservablePersistLocalStorage,
        transform: STORE_PERSIST_TRANSFORM,
      },
    })
    await when(syncState(store$).isPersistLoaded)

    expect(store$.views.streak.get()).toEqual({ currentStreak: 0 })
    // Real state still hydrates.
    expect(store$.session.userId.get()).toBe('u')
    // And the computed is still live.
    dep$.set(3)
    expect(store$.views.streak.get()).toEqual({ currentStreak: 3 })
  })

  it('heals a device that already carries a stale views row even before the view is read', async () => {
    const dep$ = observable<number>(0)
    const store$ = buildStore(dep$)

    syncObservable(store$, {
      persist: {
        name: TABLE,
        plugin: ObservablePersistLocalStorage,
        transform: STORE_PERSIST_TRANSFORM,
      },
    })
    await when(syncState(store$).isPersistLoaded)

    expect(store$.views.streak.get()).toEqual({ currentStreak: 0 })
  })
})
