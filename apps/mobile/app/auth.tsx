/**
 * Auth route for Expo Router
 */

import { AuthScreen } from 'app/features/auth'
import { useLocalSearchParams } from 'expo-router'

export default function AuthRoute() {
  const params = useLocalSearchParams<{ tab?: string; from?: string; returnTo?: string }>()
  const tab = typeof params.tab === 'string' ? params.tab : undefined
  const from = typeof params.from === 'string' ? params.from : undefined
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined

  return (
    <AuthScreen
      initialTab={tab === 'signup' ? 'signup' : 'login'}
      gateContext={from === 'collective' ? 'collective' : undefined}
      returnTo={returnTo}
    />
  )
}
