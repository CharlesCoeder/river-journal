'use client'

import { useEffectOnce, use$ } from '@legendapp/state/react'
import { appStatus$ } from 'app/state/initializeApp'
import { initializePersistence } from 'app/state/initializeApp'
import { Text } from '@my/ui'

export function PersistenceGate({ children }: { children: React.ReactNode }) {
  const isLoaded = use$(appStatus$.isPersistenceLoaded)
  const error = use$(appStatus$.error)

  useEffectOnce(() => {
    initializePersistence()
  }, [])

  if (error) {
    return <Text>Error loading application data.</Text>
  }

  return isLoaded ? <>{children}</> : null
}
