import { useCallback, useEffect, useRef, useState } from 'react'
import { Text, XStack, YStack } from '@my/ui'
import type { LayoutChangeEvent } from 'react-native'
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

function Collapsible({
  open,
  animation = 'quick',
  children,
}: {
  open: boolean
  animation?: string
  children: React.ReactNode
}) {
  const measuredHeight = useRef(0)
  // If open on mount, start with 'auto' so there's no entrance animation
  const [height, setHeight] = useState<number | 'auto'>(open ? 'auto' : 0)
  const hasAnimated = useRef(false)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h > 0) measuredHeight.current = h
  }, [])

  useEffect(() => {
    if (open) {
      // Always use 'auto' when open so content can grow/shrink freely
      setHeight('auto')
    } else {
      // Snap to measured height first so CSS can transition from number → 0
      if (height === 'auto' && measuredHeight.current > 0) {
        setHeight(measuredHeight.current)
        // Let the browser paint at measured height, then collapse
        requestAnimationFrame(() => setHeight(0))
        hasAnimated.current = true
      } else {
        setHeight(0)
        hasAnimated.current = true
      }
    }
  }, [open])

  return (
    <YStack
      overflow={height === 'auto' ? undefined : 'hidden'}
      // Only apply transition after the first close — avoids animating on mount
      transition={hasAnimated.current ? animation as any : undefined}
      height={height}
      opacity={open ? 1 : 0}
    >
      <YStack onLayout={onLayout}>
        {children}
      </YStack>
    </YStack>
  )
}

interface TrustedBrowsersListProps {
  userId: string
}

export function TrustedBrowsersList({ userId }: TrustedBrowsersListProps) {
  const [browsers, setBrowsers] = useState<TrustedBrowser[]>([])
  const [localTokenHash, setLocalTokenHash] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
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
        // Animate the row out, then refresh after animation settles
        setRemovingIds((prev) => new Set(prev).add(browser.id))
        setTimeout(() => void loadData(), 350)
        return
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
      {browsers.map((browser) => {
        const isCurrentBrowser =
          localTokenHash !== null && browser.deviceTokenHash === localTokenHash
        const isRevoking = revokingId === browser.id

        const isConfirming = confirmRevoke?.id === browser.id

        const isRemoving = removingIds.has(browser.id)

        return (
          <Collapsible
            key={browser.id}
            open={!isRemoving}
            animation="smoothCollapse"
          >
            <YStack
              paddingVertical="$3"
              borderBottomWidth={1}
              borderColor="$color2"
              opacity={isRevoking && !isRemoving ? 0.4 : 1}
              gap="$3"
            >
              <XStack
                justifyContent="space-between"
                alignItems="center"
                gap="$4"
              >
                <YStack flex={1} gap="$1">
                  <XStack gap="$2" alignItems="center">
                    <Text fontFamily="$journal" fontSize={20} color="$color">
                      {browser.label}
                    </Text>
                    {isCurrentBrowser && (
                      <Text fontFamily="$journalItalic" fontStyle="italic" fontSize={14} color="$color8">
                        (this browser)
                      </Text>
                    )}
                  </XStack>
                  <Text fontFamily="$body" fontSize={12} color="$color8" marginTop={2}>
                    Last used: {formatRelativeTime(browser.lastUsedAt)}
                  </Text>
                </YStack>

                {!isConfirming && (
                  <Text
                    testID={`revoke-browser-${browser.id}`}
                    fontFamily="$body"
                    fontSize={11}
                    letterSpacing={2}
                    textTransform="uppercase"
                    color="$color8"
                    cursor="pointer"
                    hoverStyle={{ color: '$color' }}
                    onPress={() => setConfirmRevoke(browser)}
                  >
                    {isRevoking ? 'Revoking…' : 'Revoke'}
                  </Text>
                )}
              </XStack>

              <Collapsible open={isConfirming}>
                <YStack gap="$3">
                  <Text fontFamily="$body" fontSize={13} color="$color8" lineHeight={20}>
                    {browser.label} will no longer unlock your encryption key automatically.
                    You'll need your password next time.
                  </Text>
                  <XStack gap="$5">
                    <Text
                      fontFamily="$body"
                      fontSize={11}
                      letterSpacing={2}
                      textTransform="uppercase"
                      color="$color8"
                      cursor="pointer"
                      hoverStyle={{ color: '$color' }}
                      onPress={() => setConfirmRevoke(null)}
                    >
                      Cancel
                    </Text>
                    <Text
                      testID="confirm-revoke-browser"
                      fontFamily="$body"
                      fontSize={11}
                      letterSpacing={2}
                      textTransform="uppercase"
                      color="$color"
                      cursor="pointer"
                      hoverStyle={{ opacity: 0.7 }}
                      onPress={() => void handleRevoke()}
                    >
                      Revoke
                    </Text>
                  </XStack>
                </YStack>
              </Collapsible>
            </YStack>
          </Collapsible>
        )
      })}
    </YStack>
  )
}
