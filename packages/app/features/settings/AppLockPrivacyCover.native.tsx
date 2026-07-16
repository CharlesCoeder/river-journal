/**
 * AppLockPrivacyCover.native.tsx — the app-switcher / recents snapshot privacy
 * cover (mobile only).
 *
 * The OS captures the app-switcher snapshot as the app goes INACTIVE
 * (willResignActive), which precedes `background`. So, when App Lock is enabled,
 * this opaque cover is applied on the `inactive` transition and removed on
 * `active` — otherwise the snapshot would capture journal content before any
 * cover exists. This is intentionally a DIFFERENT trigger than the auto-lock
 * timer (state/appLockTracking.ts records `backgroundedAt` on true `background`
 * only), so routine `inactive` interruptions (Control Center, notification
 * shade, permission dialogs, call banners) hide content without arming the
 * auto-lock clock.
 *
 * Mounted at the mobile app root beside <PersistentEditor /> / <NativeToast />.
 */

import { useEffect, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { View, useTheme } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { appLock$ } from '../../state/appLock'

export function AppLockPrivacyCover() {
  const enabled = use$(appLock$.enabled)
  const theme = useTheme()
  const [covered, setCovered] = useState(false)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      // Cover on anything that is not fully foregrounded (inactive OR
      // background), reveal on active. Covering on `inactive` is essential —
      // the OS snapshot is taken before `background`.
      setCovered(status !== 'active')
    })
    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove()
    }
  }, [])

  if (!enabled || !covered) return null

  const backgroundColor = theme.background?.val ?? '#000000'

  return (
    <View
      testID="app-lock-privacy-cover"
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={999}
      backgroundColor={backgroundColor}
    />
  )
}
