/**
 * Google Auth callback route
 * Handles the deep link redirect from Supabase after Google OAuth.
 * Extracts the authorization code and exchanges it for a session.
 */

import { useEffect } from 'react'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { YStack, Spinner, Text } from '@my/ui'
import { supabase } from 'app/utils/supabase'

export default function GoogleAuthCallback() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string; error?: string }>()

  useEffect(() => {
    async function handleCallback() {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('🔑 Google auth callback params:', { code: !!params.code, error: params.error })
      }

      if (params.error) {
        // OAuth error — navigate back to auth screen
        router.replace('/auth')
        return
      }

      if (params.code) {
        // Exchange the authorization code for a session
        const { error } = await supabase.auth.exchangeCodeForSession(params.code)

        if (error) {
          console.error('🔑 Failed to exchange code for session:', error.message)
          router.replace('/auth')
        } else {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('🔑 Session established successfully')
          }
          // Session set — onAuthStateChange will fire, navigate home
          router.replace('/')
        }
      } else {
        // No code or error — unexpected, go home
        router.replace('/')
      }
    }

    handleCallback()
  }, [params.code, params.error, router])

  return (
    <YStack flex={1} alignItems="center" justifyContent="center" gap="$4">
      <Spinner size="large" />
      <Text fontFamily="$body" color="$color" fontSize="$4">
        Completing sign in...
      </Text>
    </YStack>
  )
}
