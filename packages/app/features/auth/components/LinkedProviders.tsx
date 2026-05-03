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
import { YStack, XStack, Text, Separator } from '@my/ui'
import Svg, { Path } from 'react-native-svg'
import { Mail } from '@tamagui/lucide-icons'
import { useIdentityLinking } from 'app/hooks/useIdentityLinking'
import { AddPasswordForm } from './AddPasswordForm'

function GoogleLogo({ size = 16 }: { size?: number }) {
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

function ProviderRow({
  icon,
  label,
  status,
  isConnected,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode
  label: string
  status: string
  isConnected: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <YStack>
      <XStack
        paddingVertical="$4"
        alignItems="center"
        justifyContent="space-between"
      >
        <XStack gap="$3" alignItems="center" flex={1}>
          {icon}
          <YStack gap="$1">
            <Text fontSize="$5" fontFamily="$body" fontWeight={isConnected ? '600' : '400'} color={isConnected ? '$color' : '$color9'}>
              {label}
            </Text>
            <Text fontSize="$2" fontFamily="$body" color="$color8">
              {status}
            </Text>
          </YStack>
        </XStack>
        {isConnected && !actionLabel && (
          <Text
            fontSize="$1"
            fontFamily="$body"
            fontWeight="700"
            color="$blue10"
            textTransform="uppercase"
            letterSpacing={1.5}
          >
            Connected
          </Text>
        )}
        {actionLabel && onAction && (
          <Text
            fontSize="$2"
            fontFamily="$body"
            color="$color9"
            cursor="pointer"
            onPress={onAction}
            hoverStyle={{ color: '$color' }}
          >
            {actionLabel}
          </Text>
        )}
      </XStack>
      <Separator borderColor="$color2" />
    </YStack>
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
      <Text
        fontSize="$2"
        fontFamily="$body"
        color="$color9"
        textTransform="uppercase"
        letterSpacing={2}
      >
        Linked Accounts
      </Text>

      <ProviderRow
        icon={<Mail size={16} color={isLoading ? '$color8' : hasPassword ? '$color' : '$color8'} />}
        label="Email / Password"
        status={isLoading ? 'Checking…' : hasPassword ? 'Password is set' : 'No password set'}
        isConnected={!isLoading && hasPassword}
        actionLabel={isLoading ? undefined : hasPassword ? 'Change Password' : 'Add Password'}
        onAction={isLoading ? undefined : () => setShowPasswordForm(true)}
      />

      <ProviderRow
        icon={<GoogleLogo />}
        label="Google"
        status={isLoading ? 'Checking…' : isGoogleLinked ? 'Account linked' : 'Not connected'}
        isConnected={!isLoading && isGoogleLinked}
        actionLabel={isLoading ? undefined : isLinkingGoogle ? 'Connecting…' : isGoogleLinked ? undefined : 'Connect'}
        onAction={isLoading || isLinkingGoogle ? undefined : isGoogleLinked ? undefined : linkGoogle}
      />

      {error && (
        <Text fontSize="$2" color="$red10" fontFamily="$body">
          {error}
        </Text>
      )}
    </YStack>
  )
}
