/**
 * Demo state store for testing Legend-State persistence
 */

import { syncObservable } from '@legendapp/state/sync'
import { observable, syncState, batch, when } from '@legendapp/state'
import { DemoState } from './types'
import { configurePersistence } from '../persistConfig'

// Create the demo store with initial values
export const demo$ = observable<DemoState>({
  counter: 0,
  text: '',
  lastUpdated: null,
  toggleState: false,
})

// Only setup persistence on the client side
if (typeof window !== 'undefined') {
  try {
    syncObservable(
      demo$,
      configurePersistence({
        persist: {
          name: 'demo',
        },
      })
    )
  } catch (error) {
    console.error('Error setting up demo store persistence:', error)
  }
}

// Status observable for tracking when persistence is loaded
export const demoStatus$ = syncState(demo$)

// Helper function to wait for demo state to be loaded from persistence
export const waitForDemoLoaded = async () => {
  // If we're on the server, return immediately
  if (typeof window === 'undefined') {
    return true
  }

  try {
    await when(demoStatus$.isPersistLoaded)
    return true
  } catch (error) {
    console.error('Error in waitForDemoLoaded:', error)
    return false
  }
}

// Force save to persistence
export const forceSave = () => {
  const timestamp = new Date().toISOString()
  demo$.lastUpdated.set(timestamp)
}

// Helper functions for demo operations - using batch for efficiency
export const incrementCounter = () => {
  batch(() => {
    demo$.counter.set((prev) => prev + 1)
    demo$.lastUpdated.set(new Date().toISOString())
  })
}

export const decrementCounter = () => {
  batch(() => {
    demo$.counter.set((prev) => Math.max(0, prev - 1))
    demo$.lastUpdated.set(new Date().toISOString())
  })
}

export const updateText = (text: string) => {
  batch(() => {
    demo$.text.set(text)
    demo$.lastUpdated.set(new Date().toISOString())
  })
}

export const toggleState = () => {
  batch(() => {
    demo$.toggleState.set((prev) => !prev)
    demo$.lastUpdated.set(new Date().toISOString())
  })
}

export const resetDemo = () => {
  demo$.set({
    counter: 0,
    text: '',
    lastUpdated: new Date().toISOString(),
    toggleState: false,
  })
}
