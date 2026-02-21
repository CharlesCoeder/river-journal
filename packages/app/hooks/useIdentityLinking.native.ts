/**
 * useIdentityLinking — Mobile (native) implementation
 * Uses expo-web-browser for Google identity linking (same PKCE pattern as useGoogleAuth).
 * After the browser session, exchanges code and refreshes identity data.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
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
  // eslint-disable-next-line react-compiler/react-compiler
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
      const [identitiesResult, passwordResult] = await Promise.all([
        supabase.auth.getUserIdentities(),
        supabase.rpc('user_has_password'),
      ])

      if (!isMounted.current) return

      if (identitiesResult.error) throw identitiesResult.error
      if (passwordResult.error) throw passwordResult.error

      setIdentities(identitiesResult.data.identities)
      setHasPassword(passwordResult.data === true)
    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message || 'Failed to load account information.')
      }
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
      const { data, error: linkError } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: redirectUri,
        },
      })

      if (!isMounted.current) return

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

      if (!isMounted.current) return

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url)
        const code = url.searchParams.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

          if (!isMounted.current) return

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
      if (isMounted.current) {
        setError('Could not complete Google linking. Please try again.')
      }
    } finally {
      if (isMounted.current) {
        setIsLinkingGoogle(false)
      }
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
