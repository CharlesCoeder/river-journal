import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Separator, Text, XStack, YStack } from '@my/ui'
import {
  fetchTrustedBrowsers,
  revokeTrustedBrowser,
  type TrustedBrowser,
} from 'app/utils/userEncryption'
import { getStoredDeviceToken, hashDeviceToken, clearWebTrustData } from 'app/utils/webKeyStore'

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

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleRevoke = useCallback(
    async (browser: TrustedBrowser) => {
      setRevokingId(browser.id)
      try {
        const result = await revokeTrustedBrowser(browser.id)
        if (!result.error) {
          // If revoking current browser, also clear local IndexedDB
          if (localTokenHash && browser.deviceTokenHash === localTokenHash) {
            await clearWebTrustData(userId)
            setLocalTokenHash(null)
          }
          await loadData()
        }
      } finally {
        setRevokingId(null)
      }
    },
    [userId, localTokenHash, loadData]
  )

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
            <Card key={browser.id} bordered padding="$3" backgroundColor="$background">
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
                  onPress={() => void handleRevoke(browser)}
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
    </YStack>
  )
}
