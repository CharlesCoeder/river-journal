import { useCallback, useEffect, useState } from 'react'
import { AlertDialog, Button, Card, Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import {
  fetchTrustedBrowsers,
  revokeTrustedBrowser,
  type TrustedBrowser,
} from 'app/utils/userEncryption'
import { getStoredDeviceToken, hashDeviceToken, clearWebTrustData } from 'app/utils/webKeyStore'
import { trustBrowserResult$ } from 'app/state/encryptionSetup'

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

interface TrustedBrowsersListProps {
  userId: string
}

export function TrustedBrowsersList({ userId }: TrustedBrowsersListProps) {
  const [browsers, setBrowsers] = useState<TrustedBrowser[]>([])
  const [localTokenHash, setLocalTokenHash] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<TrustedBrowser | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [browserList, localToken] = await Promise.all([
        fetchTrustedBrowsers(userId).catch(() => [] as TrustedBrowser[]),
        getStoredDeviceToken(userId).catch(() => null),
      ])

      setBrowsers(browserList)

      if (localToken) {
        try {
          const hash = await hashDeviceToken(localToken)
          setLocalTokenHash(hash)
        } catch {
          setLocalTokenHash(null)
        }
      } else {
        setLocalTokenHash(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  const trustSuccess = use$(trustBrowserResult$.success)

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Re-fetch when a browser is newly trusted
  useEffect(() => {
    if (trustSuccess) {
      void loadData()
    }
  }, [trustSuccess, loadData])

  const handleRevoke = useCallback(async () => {
    if (!confirmRevoke) return
    const browser = confirmRevoke
    setConfirmRevoke(null)
    setRevokingId(browser.id)
    try {
      const result = await revokeTrustedBrowser(browser.id)
      if (!result.error) {
        if (localTokenHash && browser.deviceTokenHash === localTokenHash) {
          await clearWebTrustData(userId)
          setLocalTokenHash(null)
        }
        await loadData()
      }
    } finally {
      setRevokingId(null)
    }
  }, [confirmRevoke, userId, localTokenHash, loadData])

  if (isLoading) {
    return (
      <YStack padding="$4" alignItems="center">
        <Text fontSize="$3" fontFamily="$body" color="$color10">
          Loading…
        </Text>
      </YStack>
    )
  }

  if (browsers.length === 0) return null

  return (
    <YStack testID="trusted-browsers-list" gap="$3">
      <Text fontSize="$4" fontFamily="$body" fontWeight="700">
        Trusted browsers
      </Text>

      <YStack gap="$2">
        {browsers.map((browser) => {
          const isCurrentBrowser =
            localTokenHash !== null && browser.deviceTokenHash === localTokenHash
          const isRevoking = revokingId === browser.id

          return (
            <Card key={browser.id} padding="$3" backgroundColor="$color2" borderRadius="$4" borderWidth={1} borderColor="$color4">
              <XStack justifyContent="space-between" alignItems="center">
                <YStack flex={1} gap="$1">
                  <XStack gap="$2" alignItems="center">
                    <Text fontSize="$3" fontFamily="$body" fontWeight="600">
                      {browser.label}
                      {isCurrentBrowser ? ' (this browser)' : ''}
                    </Text>
                  </XStack>
                  <Text fontSize="$2" fontFamily="$body" color="$color10">
                    Last used: {formatRelativeTime(browser.lastUsedAt)}
                  </Text>
                </YStack>

                <Button
                  testID={`revoke-browser-${browser.id}`}
                  size="$2"
                  theme="red"
                  onPress={() => setConfirmRevoke(browser)}
                  disabled={isRevoking}
                  fontFamily="$body"
                >
                  {isRevoking ? 'Revoking…' : 'Revoke'}
                </Button>
              </XStack>
            </Card>
          )
        })}
      </YStack>
      <AlertDialog open={!!confirmRevoke} onOpenChange={() => setConfirmRevoke(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            key="overlay"
            transition="quick"
            opacity={0.4}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <AlertDialog.Content
            key="content"
            transition={['medium', { opacity: { overshootClamping: true } }]}
            enterStyle={{ y: -10, opacity: 0 }}
            exitStyle={{ y: 10, opacity: 0 }}
            y={0}
            opacity={1}
            backgroundColor="$background"
            borderRadius="$6"
            borderWidth={1}
            borderColor="$color5"
            padding="$5"
            gap="$4"
            maxWidth={400}
          >
            <AlertDialog.Title fontFamily="$body" fontWeight="700">
              Revoke browser trust?
            </AlertDialog.Title>
            <AlertDialog.Description fontFamily="$body" color="$color10">
              {confirmRevoke?.label} will no longer be able to unlock your encryption key
              automatically. You'll need to enter your password next time you use that browser.
            </AlertDialog.Description>
            <XStack gap="$3" justifyContent="flex-end">
              <AlertDialog.Cancel asChild>
                <Button chromeless borderWidth={1} borderColor="$borderColor">
                  <Text fontFamily="$body">Cancel</Text>
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  testID="confirm-revoke-browser"
                  backgroundColor="$red10"
                  color="white"
                  onPress={() => void handleRevoke()}
                  hoverStyle={{ backgroundColor: '$red11' }}
                  pressStyle={{ backgroundColor: '$red11' }}
                >
                  <Text fontFamily="$body" fontWeight="600" color="white">
                    Revoke
                  </Text>
                </Button>
              </AlertDialog.Action>
            </XStack>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog>
    </YStack>
  )
}
