import { syncObservable } from '@legendapp/state/sync'
import { syncState, when } from '@legendapp/state'
import { batch } from '@legendapp/state'
import { observable } from '@legendapp/state'
import { configurePersistence } from './persistConfig'

// Import all persisted observables
import { theme$ } from './theme'
import { journal$ } from './journal'

export const appStatus$ = observable({
  isPersistenceLoaded: false,
  error: null as Error | null,
})

function setupPersistence() {
  syncObservable(
    journal$,
    configurePersistence({
      persist: {
        name: 'journal',
      },
    })
  )
  syncObservable(
    theme$,
    configurePersistence({
      persist: {
        name: 'theme',
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
      when(syncState(journal$).isPersistLoaded),
      when(syncState(theme$).isPersistLoaded),
    ]

    // If no persisted stores yet, create a resolved promise to prevent errors.
    if (persistencePromises.length === 0) {
      persistencePromises.push(Promise.resolve(true))
    }

    // Wait for all observables to be loaded from storage.
    await Promise.all(persistencePromises)

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
