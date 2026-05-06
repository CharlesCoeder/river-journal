/**
 * TanStack Query singleton (RN variant). Re-exports the web/desktop module's
 * `queryClient` and `dehydrateOptions` symbols (identical shape) and appends
 * the RN-only side-effects: focusManager wired to AppState, onlineManager
 * wired to NetInfo. Metro's `.native.ts` resolution picks this file up
 * automatically when imported as `app/state/queryClient` from RN code.
 *
 * Boundary rule (D7): this file MUST NOT import the Legend-State package.
 */

import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { focusManager, onlineManager } from '@tanstack/react-query'

export { queryClient, dehydrateOptions } from './queryClient'

// RN focus tracking — refetch-on-focus needs an explicit AppState bridge
// because TanStack Query's default focusManager listens to the browser
// `visibilitychange` event, which doesn't exist on RN.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    handleFocus(status === 'active')
  })
  return () => sub.remove()
})

// RN online tracking — onlineManager defaults to navigator.onLine which
// doesn't exist on RN. NetInfo's listener returns its own unsubscribe.
onlineManager.setEventListener((setOnline) => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected)
  })
  return unsubscribe
})
