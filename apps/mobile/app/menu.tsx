import { useEffect } from 'react'
import { router } from 'expo-router'
import { YStack } from '@my/ui'
import { requestHubPane } from 'app/features/navigation/hubPagerState'

/**
 * The menu lives as a pane of home (see app/index.tsx). Anything that still
 * navigates here — a deep link — is sent home with the menu pane requested.
 */
export default function MenuRoute() {
  useEffect(() => {
    requestHubPane('/menu')
    router.dismissTo('/')
  }, [])
  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    />
  )
}
