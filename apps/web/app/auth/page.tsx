'use client'

import { AuthScreen } from 'app/features/auth'
import { useSearchParams } from 'next/navigation'

export default function AuthPage() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const initialTab = tab === 'signup' ? 'signup' : 'login'

  return <AuthScreen initialTab={initialTab} />
}
