/**
 * useGoogleAuth hook for mobile Google OAuth flow
 * Uses Supabase PKCE flow via WebBrowser for cross-platform compatibility.
 * Flow: App → Supabase → Google consent → Supabase callback → App deep link
 *
 * On iOS: openAuthSessionAsync captures the redirect URL directly — code exchange
 *         happens here in the hook, then navigates to home.
 * On Android: openAuthSessionAsync doesn't capture the redirect — the deep link
 *             falls through to the Expo Router callback route (app/google-auth.tsx).
 */

import { useCallback, useState, useRef, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { supabase } from 'app/utils/supabase'

// Required for proper redirect handling on Android
WebBrowser.maybeCompleteAuthSession()

const redirectUri = Linking.createURL('google-auth')

interface UseGoogleAuthResult {
  promptAsync: () => Promise<void>
  isLoading: boolean
  error: string | null
}

export function useGoogleAuth(onSuccess?: () => void): UseGoogleAuthResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  // eslint-disable-next-line react-compiler/react-compiler
  const isMounted = useRef(true)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const promptAsync = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      // 1. Get the OAuth URL from Supabase (with PKCE code challenge)
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      })

      if (!isMounted.current) return

      if (oauthError) {
        setError(oauthError.message || 'Failed to start Google sign in.')
        setIsLoading(false)
        return
      }

      if (!data?.url) {
        setError('Failed to start Google sign in.')
        setIsLoading(false)
        return
      }

      // 2. Open browser for Google consent → Supabase callback → redirect
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri)

      if (!isMounted.current) return

      if (result.type === 'success' && result.url) {
        // iOS: openAuthSessionAsync captures the redirect URL directly.
        // Extract the code and exchange it for a session here.
        const url = new URL(result.url)
        const code = url.searchParams.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

          if (!isMounted.current) return

          if (exchangeError) {
            setError(exchangeError.message || 'Authentication failed. Please try again.')
          } else {
            // Session established — navigate home immediately
            onSuccess?.()
            router.replace('/')
          }
        } else {
          setError('Authentication failed. No authorization code received.')
        }
      } else if (result.type === 'dismiss' || result.type === 'cancel') {
        setError('Sign in was cancelled. Please try again.')
      }
      // Android: result.type may not be 'success' — the deep link falls through
      // to the Expo Router callback route (app/google-auth.tsx) which handles it.
    } catch {
      if (isMounted.current) {
        setError('Could not complete sign in. Please try again.')
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false)
      }
    }
  }, [router, onSuccess])

  return { promptAsync, isLoading, error }
}
