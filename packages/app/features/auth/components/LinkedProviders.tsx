/**
 * LinkedProviders — Displays connected auth providers and action buttons.
 *
 * Renders based on identity + password status:
 *   - Google OAuth only, no password → "Add Password" button
 *   - Google OAuth + password → "Change Password" button
 *   - Email only → "Change Password" + "Connect Google" button
 *   - Both linked → both shown as connected
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Text, Button, Spinner } from '@my/ui'
import Svg, { Path } from 'react-native-svg'
import { Mail, Check } from '@tamagui/lucide-icons'
import { useIdentityLinking } from 'app/hooks/useIdentityLinking'
import { AddPasswordForm } from './AddPasswordForm'

function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  )
}

export function LinkedProviders() {
  const {
    hasPassword,
    isGoogleLinked,
    isLoading,
    isLinkingGoogle,
    error,
    linkGoogle,
    refresh,
  } = useIdentityLinking()

  const [showPasswordForm, setShowPasswordForm] = useState(false)

  const handlePasswordSuccess = useCallback(() => {
    setShowPasswordForm(false)
    refresh()
  }, [refresh])

  if (isLoading) {
    return (
      <YStack padding="$4" alignItems="center">
        <Spinner />
      </YStack>
    )
  }

  if (showPasswordForm) {
    return (
      <AddPasswordForm
        mode={hasPassword ? 'change' : 'add'}
        onSuccess={handlePasswordSuccess}
        onCancel={() => setShowPasswordForm(false)}
      />
    )
  }

  return (
    <YStack gap="$3" width="100%">
      <Text fontSize="$5" fontFamily="$body" fontWeight="600">
        Linked Accounts
      </Text>

      {/* Email / Password row */}
      <XStack
        backgroundColor="$color2"
        borderRadius="$4"
        padding="$3"
        alignItems="center"
        justifyContent="space-between"
      >
        <XStack gap="$3" alignItems="center" flex={1}>
          <Mail size={20} color="$color11" />
          <YStack>
            <Text fontFamily="$body" fontWeight="500">
              Email / Password
            </Text>
            <Text fontSize="$2" fontFamily="$body" color="$color10">
              {hasPassword ? 'Connected' : 'No password set'}
            </Text>
          </YStack>
        </XStack>
        <Button size="$3" variant="outlined" onPress={() => setShowPasswordForm(true)}>
          <Text fontSize="$2" fontFamily="$body">
            {hasPassword ? 'Change Password' : 'Add Password'}
          </Text>
        </Button>
      </XStack>

      {/* Google row */}
      <XStack
        backgroundColor="$color2"
        borderRadius="$4"
        padding="$3"
        alignItems="center"
        justifyContent="space-between"
      >
        <XStack gap="$3" alignItems="center" flex={1}>
          <GoogleLogo />
          <YStack>
            <Text fontFamily="$body" fontWeight="500">
              Google
            </Text>
            <Text fontSize="$2" fontFamily="$body" color="$color10">
              {isGoogleLinked ? 'Connected' : 'Not connected'}
            </Text>
          </YStack>
        </XStack>
        {isGoogleLinked ? (
          <Check size={20} color="$green10" />
        ) : (
          <Button
            size="$3"
            variant="outlined"
            onPress={linkGoogle}
            disabled={isLinkingGoogle}
          >
            {isLinkingGoogle ? (
              <Spinner size="small" />
            ) : (
              <Text fontSize="$2" fontFamily="$body">
                Connect Google
              </Text>
            )}
          </Button>
        )}
      </XStack>

      {error && (
        <Text fontSize="$2" color="$red10" fontFamily="$body">
          {error}
        </Text>
      )}
    </YStack>
  )
}
