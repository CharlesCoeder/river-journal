/**
 * BillingDisclosure — renders the platform-aware billing disclosure copy.
 *
 * Platform detection uses the repo idioms: `isWeb` from `@my/ui` is true for
 * BOTH web and the Tauri desktop runtime (Stripe copy covers both), and
 * `Platform.OS` distinguishes iOS from Android for native. The exact copy
 * comes from the pure resolver so the string stays table-tested in one place.
 */

import { Platform } from 'react-native'
import { Text, isWeb } from '@my/ui'
import { resolveBillingDisclosureCopy } from 'app/utils/billing/platformDisclosure'
import type { BillingPlatform } from 'app/utils/billing/platformDisclosure'

function resolvePlatform(): BillingPlatform {
  if (isWeb) return 'web'
  return Platform.OS === 'android' ? 'android' : 'ios'
}

export function BillingDisclosure() {
  const copy = resolveBillingDisclosureCopy(resolvePlatform())
  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      color="$color8"
      letterSpacing={0.5}
    >
      {copy}
    </Text>
  )
}
