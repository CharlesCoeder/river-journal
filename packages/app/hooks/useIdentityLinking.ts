/**
 * useIdentityLinking — Web implementation
 * Provides identity/provider data and Google linking via redirect-based OAuth.
 * After redirect, the page reloads and onAuthStateChange handles session update.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from 'app/utils/supabase'
import type { UserIdentity } from '@supabase/supabase-js'

export interface IdentityLinkingState {
  identities: UserIdentity[]
  hasPassword: boolean
  isGoogleLinked: boolean
  isLoading: boolean
  isLinkingGoogle: boolean
  error: string | null
  linkGoogle: () => Promise<void>
  refresh: () => Promise<void>
}

export function useIdentityLinking(): IdentityLinkingState {
  const [identities, setIdentities] = useState<UserIdentity[]>([])
  const [hasPassword, setHasPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetchProviderData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [identitiesResult, passwordResult] = await Promise.allSettled([
        supabase.auth.getUserIdentities(),
        supabase.rpc('user_has_password'),
      ])

      const identitiesOk =
        identitiesResult.status === 'fulfilled' && !identitiesResult.value.error
      const passwordOk =
        passwordResult.status === 'fulfilled' && !passwordResult.value.error

      if (!identitiesOk) {
        const err =
          identitiesResult.status === 'fulfilled'
            ? identitiesResult.value.error
            : identitiesResult.reason
        throw err
      }

      if (!isMounted.current) return

      setIdentities(identitiesResult.value.data?.identities ?? [])
      setHasPassword(passwordOk ? passwordResult.value.data === true : false)
    } catch (err: any) {
      if (!isMounted.current) return
      setError(err.message || 'Failed to load account information.')
    } finally {
      if (isMounted.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchProviderData()
  }, [fetchProviderData])

  const isGoogleLinked = identities.some((i) => i.provider === 'google')

  const linkGoogle = useCallback(async () => {
    setIsLinkingGoogle(true)
    setError(null)
    try {
      const { error: linkError } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo:
            typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })

      if (linkError) {
        if (isMounted.current) {
          setError(linkError.message)
          setIsLinkingGoogle(false)
        }
        return
      }

      // Page should redirect to Google consent. If redirect silently fails,
      // reset after 10s so the button doesn't stay stuck in a spinner.
      setTimeout(() => {
        if (isMounted.current) {
          setIsLinkingGoogle(false)
        }
      }, 10_000)
    } catch {
      if (isMounted.current) {
        setError('Could not connect to Google. Please try again.')
        setIsLinkingGoogle(false)
      }
    }
  }, [])

  return {
    identities,
    hasPassword,
    isGoogleLinked,
    isLoading,
    isLinkingGoogle,
    error,
    linkGoogle,
    refresh: fetchProviderData,
  }
}
