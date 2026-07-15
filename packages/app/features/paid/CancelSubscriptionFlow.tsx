/**
 * CancelSubscriptionFlow — the locked-Dialog ≤3-step cancel state machine.
 *
 * A controlled, locked Dialog (mirrors the locked-dialog styling: $shadow6
 * overlay, $color3 1px content border, reduced-motion-gated 'quick' animation,
 * no tap-outside-dismiss) that walks the user through cancellation in at most
 * three in-app steps and NO retention friction:
 *
 *   confirm → cancelling → cancelled | native-action | error
 *
 * Step 1 (confirm): plain-language summary + Confirm cancel + Keep subscription.
 *   No retention questionnaire, no discount offer, no reason field, no
 *   are-you-sure loop.
 * Step 2 (cancelling): the cancel Edge Function is called; Confirm is disabled
 *   in flight so a double-tap can't fire two cancels.
 * Step 3 (terminal):
 *   - Stripe (requires_native_action: false): "Cancelled. Thanks for being
 *     here." + Done.
 *   - Apple/Play (requires_native_action: true): the native-action screen
 *     appears automatically (no extra reveal tap) with an Open [Store]
 *     deep-link and a calm, always-visible fallback line — never a dead end.
 *   - Any failure: a calm inline message (role="status") + a single Retry,
 *     never a support loop, never a scarier message for the generic 404. Keep
 *     subscription stays available.
 *
 * This flow NEVER writes an early downgrade to the client store — the tier flip
 * to free at period end is exclusively server-owned. Telemetry is server-owned
 * and metadata-only (`subscription.cancel.ok`); no client capture is built.
 */

import { useCallback, useRef, useState } from 'react'
import { Dialog, Text, XStack, YStack, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { cancelSubscription } from 'app/utils/billing/subscriptionApi'
import type { BillingProvider } from 'app/utils/billing/subscriptionApi'
import { formatPeriodEnd } from 'app/utils/billing/formatPeriodEnd'
import { resolveNativeStoreLink } from './nativeStoreLinks'

// react-native's Linking, resolved via a deferred dynamic import rather than a
// top-level `import { Linking } from 'react-native'` so the web bundle never
// statically pulls in react-native. react-native-web maps Linking on web, so a
// single cross-platform path works. A failed warm-up does not latch (the
// in-flight promise is cleared) so a later tap can retry.
let cachedLinking: typeof import('react-native').Linking | null = null
let linkingWarmPromise: Promise<typeof import('react-native').Linking | null> | null = null

function warmLinking(): Promise<typeof import('react-native').Linking | null> {
  if (cachedLinking !== null) return Promise.resolve(cachedLinking)
  if (linkingWarmPromise === null) {
    linkingWarmPromise = import('react-native')
      .then((rn) => {
        cachedLinking = rn.Linking
        return cachedLinking
      })
      .catch((error) => {
        linkingWarmPromise = null
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[cancel-flow] failed to resolve react-native Linking', error)
        }
        return null
      })
  }
  return linkingWarmPromise
}

function openStoreLink(url: string): void {
  if (cachedLinking !== null) {
    // openURL itself can reject (dead scheme / no handler); swallowing keeps the
    // screen calm — the always-visible fallback line covers the dead-end case.
    void cachedLinking.openURL(url).catch(() => {})
    return
  }
  void warmLinking().then((linking) => {
    void linking?.openURL(url).catch(() => {})
  })
}

type FlowState = 'confirm' | 'cancelling' | 'cancelled' | 'native-action' | 'error'

export interface CancelSubscriptionFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: BillingProvider
  subscriptionId: string
  currentPeriodEnd: string
  onCancelled: () => void
}

export function CancelSubscriptionFlow({
  open,
  onOpenChange,
  provider,
  subscriptionId,
  currentPeriodEnd,
  onCancelled,
}: CancelSubscriptionFlowProps) {
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  const [state, setState] = useState<FlowState>('confirm')
  const inFlightRef = useRef(false)

  // Warm the react-native Linking cache so the store deep-link can open promptly
  // once the native-action screen is reached.
  warmLinking()

  const formattedPeriodEnd = formatPeriodEnd(currentPeriodEnd)
  const summary = formattedPeriodEnd
    ? `Your subscription will end on ${formattedPeriodEnd}. Cosmetics remain available until then. Streak progression continues unchanged.`
    : 'Your subscription will end at the end of your current billing period. Cosmetics remain available until then. Streak progression continues unchanged.'

  const runCancel = useCallback(async () => {
    // Double-fire guard — a double-tap or a rapid Retry must fire only one call.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setState('cancelling')

    const result = await cancelSubscription({ provider, subscription_id: subscriptionId })
    inFlightRef.current = false

    if (result.ok) {
      if (result.requires_native_action) {
        setState('native-action')
      } else {
        setState('cancelled')
        // Drives the receipt-query refetch so Billing reflects status='canceled'.
        onCancelled()
      }
    } else {
      setState('error')
    }
  }, [provider, subscriptionId, onCancelled])

  const handleKeep = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleDone = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const nativeLink = provider === 'stripe' ? null : resolveNativeStoreLink(provider)

  const isCancelling = state === 'cancelling'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="cancel-overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="cancel-content"
          gap="$3"
          padding="$4"
          maxWidth={420}
          width="90%"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          animation={animationToken}
        >
          <Dialog.Title
            fontSize="$5"
            fontFamily="$body"
          >
            Cancel subscription
          </Dialog.Title>

          {(state === 'confirm' || state === 'cancelling' || state === 'error') && (
            <Text
              fontSize="$3"
              color="$color12"
            >
              {summary}
            </Text>
          )}

          {state === 'error' && (
            <YStack
              role="status"
              aria-live="polite"
            >
              <Text
                fontSize="$3"
                color="$color11"
              >
                Something went wrong on our end. Please try again.
              </Text>
            </YStack>
          )}

          {state === 'cancelled' && (
            <YStack
              role="status"
              aria-live="polite"
            >
              <Text
                fontSize="$3"
                color="$color12"
              >
                Cancelled. Thanks for being here.
              </Text>
            </YStack>
          )}

          {state === 'native-action' && nativeLink && (
            <YStack gap="$2">
              <YStack
                role="status"
                aria-live="polite"
              >
                <Text
                  fontSize="$3"
                  color="$color12"
                >
                  {`Cancellation requires confirming via ${nativeLink.storeName}.`}
                </Text>
              </YStack>
              <Text
                fontSize="$2"
                color="$color11"
              >
                {`If nothing opened, manage your subscription in the ${nativeLink.storeName} settings.`}
              </Text>
            </YStack>
          )}

          <XStack
            gap="$3"
            justifyContent="flex-end"
            marginTop="$3"
          >
            {(state === 'confirm' || state === 'cancelling') && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep subscription"
                >
                  Keep subscription
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={runCancel}
                  disabled={isCancelling}
                  accessibilityLabel="Confirm cancel"
                >
                  Confirm cancel
                </ExpandingLineButton>
              </>
            )}

            {state === 'error' && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep subscription"
                >
                  Keep subscription
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={runCancel}
                  accessibilityLabel="Retry"
                >
                  Retry
                </ExpandingLineButton>
              </>
            )}

            {state === 'cancelled' && (
              <ExpandingLineButton
                onPress={handleDone}
                accessibilityLabel="Done"
              >
                Done
              </ExpandingLineButton>
            )}

            {state === 'native-action' && nativeLink && (
              <ExpandingLineButton
                onPress={() => openStoreLink(nativeLink.url)}
                accessibilityLabel={nativeLink.label}
              >
                {nativeLink.label}
              </ExpandingLineButton>
            )}
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default CancelSubscriptionFlow
