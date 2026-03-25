'use client'

import { useState, useEffect } from 'react'
import { initializePersistence } from 'app/state/initializeApp'
import { Text } from '@my/ui'

export function PersistenceGate({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    initializePersistence()
      .then(() => setIsLoaded(true))
      .catch(() => setError(true))
  }, [])

  if (error) {
    return <Text>Error loading application data.</Text>
  }

  return isLoaded ? <>{children}</> : null
}
