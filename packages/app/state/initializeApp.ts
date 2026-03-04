import { syncObservable } from '@legendapp/state/sync'
import { syncState, when, observe } from '@legendapp/state'
import { batch } from '@legendapp/state'
import { observable } from '@legendapp/state'
import { configurePersistence } from './persistConfig'
import { store$ } from './store'
import { flows$ } from './flows'
import { entries$ } from './entries'
import { isSyncReady$, syncUserId$ } from './syncConfig'
import { initAuthListener } from '../utils/auth'

export const appStatus$ = observable({
  isPersistenceLoaded: false,
  error: null as Error | null,
})

function setupPersistence() {
  // Persist the core store only (session, profile, activeFlow, lastSavedFlow).
  // flows$ and entries$ handle their own persistence via syncedSupabase({ persist }).
  syncObservable(
    store$,
    configurePersistence({
      persist: {
        name: 'app-state',
      },
    })
  )

  // Activate the synced observables so their persistence loads.
  // syncedSupabase uses lazy activation — calling .get() triggers persistence
  // loading while remote sync waits for the waitFor gate.
  flows$.get()
  entries$.get()
}

function setupSyncReadinessGate() {
  // Reactively wire isSyncReady$ and syncUserId$ to store$.session,
  // avoiding circular imports between store.ts and flows.ts/entries.ts.
  observe(() => {
    const isAuthenticated = store$.session.isAuthenticated.get()
    const syncEnabled = store$.session.syncEnabled.get()
    const userId = store$.session.userId.get()

    const ready = isAuthenticated && syncEnabled
    isSyncReady$.set(ready)
    syncUserId$.set(userId)

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('🔗 [syncGate]', { isAuthenticated, syncEnabled, ready, userId: userId?.slice(0, 8) ?? null })
    }
  })
}

export async function initializePersistence() {
  try {
    setupPersistence()
    setupSyncReadinessGate()

    const persistencePromises = [
      when(syncState(store$).isPersistLoaded),
      when(syncState(flows$).isPersistLoaded),
      when(syncState(entries$).isPersistLoaded),
    ]

    await Promise.all(persistencePromises)

    // Initialize auth listener — fires INITIAL_SESSION immediately to hydrate
    // session state, then handles SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, etc.
    initAuthListener()

    // Dev flag: auto-enable sync via env var so developers can test sync
    // without waiting for the UI toggle story. Add to your .env.local:
    //   NEXT_PUBLIC_SYNC_ENABLED=true   (web / desktop)
    //   EXPO_PUBLIC_SYNC_ENABLED=true   (mobile)
    const envSyncEnabled =
      process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' ||
      process.env.EXPO_PUBLIC_SYNC_ENABLED === 'true'

    if (envSyncEnabled) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔄 Sync auto-enabled via env flag')
      }
    }

    batch(() => {
      if (envSyncEnabled) {
        store$.session.syncEnabled.set(true)
      }
      appStatus$.isPersistenceLoaded.set(true)
      appStatus$.error.set(null)
    })
  } catch (e) {
    appStatus$.error.set(e as Error)
    console.error('Failed to initialize persistence', e)
  }
}
