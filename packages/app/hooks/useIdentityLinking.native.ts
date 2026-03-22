/**
 * useIdentityLinking — Mobile (native) implementation
 * Uses expo-web-browser for Google identity linking (same PKCE pattern as useGoogleAuth).
 * After the browser session, exchanges code and refreshes identity data.
 *
 * NOTE: This hook intentionally avoids the `isMounted` ref pattern.
 * React 18 Strict Mode double-mounts components in dev: the first unmount
 * sets isMounted=false, but the second mount never resets it to true.
 * This causes every setState after an await to be silently skipped,
 * leaving the component permanently stuck in its loading state.
 * React 18 no longer warns on setState after unmount, so the guard is unnecessary.
 */

import { useState, useCallback, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from 'app/utils/supabase'
import type { UserIdentity } from '@supabase/supabase-js'

WebBrowser.maybeCompleteAuthSession()

const redirectUri = Linking.createURL('google-auth')

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

  const fetchProviderData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // The Legend-State store may report isAuthenticated from persisted state
      // before the Supabase client has restored its session. Bail early if
      // there's no live session to avoid hanging API calls.
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setIsLoading(false)
        return
      }

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

      setIdentities(identitiesResult.value.data?.identities ?? [])
      setHasPassword(passwordOk ? passwordResult.value.data === true : false)
    } catch (err: any) {
      setError(err.message || 'Failed to load account information.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviderData()

    // Re-fetch when a real session arrives. Only listen for SIGNED_IN and
    // INITIAL_SESSION — TOKEN_REFRESHED is excluded because getSession()
    // above can itself trigger a token refresh, which would create a loop.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        fetchProviderData()
      }
    })
    return () => subscription.unsubscribe()
  }, [fetchProviderData])

  const isGoogleLinked = identities.some((i) => i.provider === 'google')

  const linkGoogle = useCallback(async () => {
    setIsLinkingGoogle(true)
    setError(null)
    try {
      const { data, error: linkError } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: redirectUri,
        },
      })

      if (linkError) {
        setError(linkError.message || 'Failed to start Google linking.')
        setIsLinkingGoogle(false)
        return
      }

      if (!data?.url) {
        setError('Failed to start Google linking.')
        setIsLinkingGoogle(false)
        return
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri)

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url)
        const code = url.searchParams.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

          if (exchangeError) {
            setError(exchangeError.message || 'Failed to link Google account.')
          } else {
            await fetchProviderData()
          }
        } else {
          setError('Linking failed. No authorization code received.')
        }
      } else if (result.type === 'dismiss' || result.type === 'cancel') {
        setError('Linking was cancelled. You can try again anytime.')
      }
      // Android: deep link may fall through to google-auth.tsx callback route
    } catch {
      setError('Could not complete Google linking. Please try again.')
    } finally {
      setIsLinkingGoogle(false)
    }
  }, [fetchProviderData])

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
