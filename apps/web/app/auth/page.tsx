'use client'

import { Suspense } from 'react'
import { AuthScreen } from 'app/features/auth'
import { useSearchParams } from 'next/navigation'

function AuthPageContent() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const initialTab = tab === 'signup' ? 'signup' : 'login'
  const from = searchParams.get('from')
  const returnTo = searchParams.get('returnTo')

  return (
    <AuthScreen
      initialTab={initialTab}
      gateContext={from === 'collective' ? 'collective' : undefined}
      returnTo={returnTo ?? undefined}
    />
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageContent />
    </Suspense>
  )
}
