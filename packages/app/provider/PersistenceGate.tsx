'use client'

import { useState, useEffect } from 'react'
import { use$ } from '@legendapp/state/react'
import { initializePersistence } from 'app/state/initializeApp'
import { persistenceStatus$ } from 'app/state/persistenceStatus'
import { Button, Text, YStack } from '@my/ui'

function reloadPage() {
  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

/**
 * Shown when THIS tab has released its database connection because a newer
 * build in another tab is upgrading the schema (see
 * persistConfig.ts#armPersistenceVersionChangeHandler). Persistence is closed
 * from here on, so the UI is replaced rather than left accepting edits that
 * could never be saved. Reload is a button, not automatic — nothing should
 * happen under the user's feet.
 */
function StaleTabNotice() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$4"
    >
      <Text
        fontWeight="600"
        testID="persistence-stale-tab"
      >
        River Journal was updated in another tab.
      </Text>
      <Text textAlign="center">Reload this tab to keep writing.</Text>
      <Button onPress={reloadPage}>Reload</Button>
    </YStack>
  )
}

/**
 * Shown while this tab's boot is waiting on a schema upgrade that another tab
 * running an older build is blocking (see
 * persistConfig.ts#openPersistenceDatabase). Boot resumes on its own the moment
 * that tab closes or reloads; this only tells the user what to do.
 */
function BlockedByOtherTabNotice() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$4"
    >
      <Text
        fontWeight="600"
        testID="persistence-blocked-by-other-tab"
      >
        Waiting for another River Journal tab.
      </Text>
      <Text textAlign="center">
        An older River Journal tab is still open. Close or reload it to continue.
      </Text>
    </YStack>
  )
}

export function PersistenceGate({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState(false)
  const blockedByOtherTab = use$(persistenceStatus$.blockedByOtherTab)
  const staleTab = use$(persistenceStatus$.staleTab)

  useEffect(() => {
    initializePersistence()
      .then(() => setIsLoaded(true))
      .catch(() => setError(true))
  }, [])

  if (staleTab) {
    return <StaleTabNotice />
  }

  if (error) {
    return <Text>Error loading application data.</Text>
  }

  if (!isLoaded) {
    return blockedByOtherTab ? <BlockedByOtherTabNotice /> : null
  }

  return <>{children}</>
}
