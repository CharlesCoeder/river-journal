import { syncObservable } from '@legendapp/state/sync'
import { syncState, when } from '@legendapp/state'
import { batch } from '@legendapp/state'
import { observable } from '@legendapp/state'
import { configurePersistence } from './persistConfig'
import { store$ } from './store'
import { flows$ } from './flows'
import { entries$ } from './entries'
import { initAuthListener } from '../utils/auth'

export const appStatus$ = observable({
  isPersistenceLoaded: false,
  error: null as Error | null,
})

function setupPersistence() {
  // Persist the core store (session, profile, activeFlow, lastSavedFlow)
  syncObservable(
    store$,
    configurePersistence({
      persist: {
        name: 'app-state',
      },
    })
  )

  // Persist flows as a separate observable with its own storage key
  syncObservable(
    flows$,
    configurePersistence({
      persist: {
        name: 'flows',
      },
    })
  )

  // Persist entries as a separate observable with its own storage key
  syncObservable(
    entries$,
    configurePersistence({
      persist: {
        name: 'entries',
      },
    })
  )
}

export async function initializePersistence() {
  try {
    // Call setup for all observables
    setupPersistence()

    // Create an array of promises that resolve when each persisted observable is loaded.
    // The syncState helper returns an observable with load statuses.
    const persistencePromises = [
      when(syncState(store$).isPersistLoaded),
      when(syncState(flows$).isPersistLoaded),
      when(syncState(entries$).isPersistLoaded),
    ]

    // Wait for all observables to be loaded from storage.
    await Promise.all(persistencePromises)

    // Initialize auth listener — fires INITIAL_SESSION immediately to hydrate
    // session state, then handles SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, etc.
    initAuthListener()

    // Once all are loaded, update the global state.
    batch(() => {
      appStatus$.isPersistenceLoaded.set(true)
      appStatus$.error.set(null)
    })
  } catch (e) {
    // If any persistence loading fails, report the error.
    appStatus$.error.set(e as Error)
    console.error('Failed to initialize persistence', e)
  }
}
