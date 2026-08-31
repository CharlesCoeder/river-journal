/**
 * CancelSubscriptionFlow — the ≤3-step cancel state machine Dialog.
 *
 * A controlled modal Dialog (mirrors the shared dialog styling: $shadow6
 * overlay, $color3 1px content border, reduced-motion-gated 'quick' animation)
 * that walks the user through cancellation in at most three in-app steps and NO
 * retention friction:
 *
 *   confirm → cancelling → cancelled | native-action | error
 *
 * Dismissal: Keep subscription / Done, plus the standard modal overlay/escape
 * dismiss, all route through `onOpenChange(false)`. The state machine resets to
 * `confirm` (and clears the in-flight guard) on every open transition, so a
 * dialog that was dismissed mid-error or mid-native-action always reopens on a
 * clean confirmation screen — no stale error + Retry, no stale native leg.
 *
 * Step 1 (confirm): plain-language summary + Confirm cancel + Keep subscription.
 *   No retention questionnaire, no discount offer, no reason field, no
 *   are-you-sure loop.
 * Step 2 (cancelling): the cancel Edge Function is called; both Confirm and Keep
 *   are disabled in flight so a double-tap can't fire two cancels and a mid-flight
 *   Keep can't close the dialog over a cancel the server is already applying.
 * Step 3 (terminal):
 *   - Stripe (requires_native_action: false): "Cancelled. Thanks for being
 *     here." + Done.
 *   - Apple/Play (requires_native_action: true): the native-action screen
 *     appears automatically (no extra reveal tap) with an Open [Store]
 *     deep-link, a calm always-visible fallback line, and an explicit Done — never
 *     a dead end. If the envelope claims native action but no store link resolves
 *     (a provider/flag mismatch, e.g. stripe + requires_native_action), it falls
 *     back to the Done acknowledgment rather than rendering a blank dialog.
 *   - Any failure: a calm inline message (role="status") + a single Retry,
 *     never a support loop, never a scarier message for the generic 404. Keep
 *     subscription stays available.
 *
 * On every successful terminal (Stripe done OR native-action reached OR the
 * mismatch fallback), the `onCancelled` callback fires exactly once to drive the
 * Billing surface's receipt-query refetch.
 *
 * This flow NEVER writes an early downgrade to the client store — the tier flip
 * to free at period end is exclusively server-owned. Telemetry is server-owned
 * and metadata-only (`subscription.cancel.ok`); no client capture is built.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
  // once the native-action screen is reached. Runs as an effect (not during
  // render) so it stays pure and StrictMode's double-invoke can't double-fire
  // the pre-cache.
  useEffect(() => {
    warmLinking()
  }, [])

  // Reset the state machine on every closed→open transition. Without this, a
  // dialog dismissed mid-error (or mid-native-action) would reopen showing the
  // stale terminal screen — and a single Retry tap would fire a cancel the user
  // never re-confirmed. Clearing inFlightRef here also unlatches the double-fire
  // guard if the dialog was torn down while a request was still pending.
  const prevOpenRef = useRef(open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setState('confirm')
      inFlightRef.current = false
    }
    prevOpenRef.current = open
  }, [open])

  const formattedPeriodEnd = formatPeriodEnd(currentPeriodEnd)
  const summary = formattedPeriodEnd
    ? `Your subscription will end on ${formattedPeriodEnd}. Cosmetics remain available until then. Streak progression continues unchanged.`
    : 'Your subscription will end at the end of your current billing period. Cosmetics remain available until then. Streak progression continues unchanged.'

  const nativeLink = provider === 'stripe' ? null : resolveNativeStoreLink(provider)

  const runCancel = useCallback(async () => {
    // Double-fire guard — a double-tap or a rapid Retry must fire only one call.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setState('cancelling')

    try {
      const result = await cancelSubscription({ provider, subscription_id: subscriptionId })

      if (result.ok) {
        if (result.requires_native_action && nativeLink) {
          setState('native-action')
        } else {
          // Normal Stripe cancel OR a native-action envelope whose provider has
          // no resolvable store link (a provider/flag mismatch) — never dead-end
          // on a blank native screen; land on the Done acknowledgment instead.
          setState('cancelled')
        }
        // Drives the receipt-query refetch so Billing reflects the cancel, on
        // every successful terminal (including the native-action path).
        onCancelled()
      } else {
        setState('error')
      }
    } finally {
      inFlightRef.current = false
    }
  }, [provider, subscriptionId, onCancelled, nativeLink])

  const handleKeep = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleDone = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

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
                  disabled={isCancelling}
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
              <>
                <ExpandingLineButton
                  onPress={handleDone}
                  accessibilityLabel="Done"
                >
                  Done
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={() => openStoreLink(nativeLink.url)}
                  accessibilityLabel={nativeLink.label}
                >
                  {nativeLink.label}
                </ExpandingLineButton>
              </>
            )}
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default CancelSubscriptionFlow
