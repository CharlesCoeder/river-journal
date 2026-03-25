import { syncObservable } from '@legendapp/state/sync'
import { syncState, when, observe } from '@legendapp/state'
import { batch } from '@legendapp/state'
import { observable } from '@legendapp/state'
import { configurePersistence } from './persistConfig'
import { store$, countUndecidedOrphans } from './store'
import { flows$ } from './flows'
import { entries$ } from './entries'
import { generateUUID, isSyncReady$, syncUserId$, orphanFlowsPending$ } from './syncConfig'
import { initAuthListener } from '../utils/auth'
import { isEncryptionReadyForSync$ } from './encryptionSetup'

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
  // Reactively wire isSyncReady$, syncUserId$, and orphanFlowsPending$ to
  // store$.session, avoiding circular imports between store.ts and flows.ts/entries.ts.
  observe(() => {
    const isAuthenticated = store$.session.isAuthenticated.get()
    const syncEnabled = store$.session.syncEnabled.get()
    const userId = store$.session.userId.get()
    const isEncryptionReadyForSync = isEncryptionReadyForSync$.get()

    if (!isAuthenticated || !syncEnabled || !userId || !isEncryptionReadyForSync) {
      // Not ready for sync — clear orphan state and close gate
      orphanFlowsPending$.set(null)
      isSyncReady$.set(false)
      syncUserId$.set(userId)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] closed', {
          isAuthenticated,
          syncEnabled,
          userId: userId?.slice(0, 8) ?? null,
          isEncryptionReadyForSync,
        })
      }
      return
    }

    // Authenticated + sync enabled: check for undecided orphan flows
    syncUserId$.set(userId)
    const { flowCount, entryCount } = countUndecidedOrphans()

    if (flowCount > 0 || entryCount > 0) {
      // Orphans pending user decision — keep gate closed, show dialog
      orphanFlowsPending$.set({ flowCount, entryCount, userId })
      isSyncReady$.set(false)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] orphans pending consent', { flowCount, entryCount, userId: userId.slice(0, 8) })
      }
    } else {
      // No undecided orphans — open sync gate immediately
      orphanFlowsPending$.set(null)
      isSyncReady$.set(true)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] open (no orphans)', { userId: userId.slice(0, 8) })
      }
    }
  })
}

function ensureLocalSessionId() {
  const existingLocalSessionId = store$.session.localSessionId.get()
  if (existingLocalSessionId) return

  store$.session.localSessionId.set(generateUUID())
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
    ensureLocalSessionId()

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
    throw e
  }
}
