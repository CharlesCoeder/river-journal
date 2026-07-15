/**
 * PaidTierPurchaseSurface — the calm, platform-agnostic purchase surface.
 *
 * A full-screen route (not a dialog) with a four-state machine:
 *   idle -> purchasing -> purchased | error
 *
 * It renders plain pricing (no urgency chrome, no badges), a platform-aware
 * billing disclosure, and a Subscribe affordance. Subscribe kicks off the
 * platform billing flow (`attemptPurchase`), forwards the resulting receipt to
 * the server (`validateReceipt`), and — only on the server's authoritative
 * success — reflects the returned tier onto the client store, which unlocks
 * cosmetics reactively. A user-cancel is silent (return to idle, no error); a
 * validation failure surfaces a single calm warm-dot toast + Retry.
 *
 * Already-subscribed users see a "You're already subscribed" affordance
 * instead of the purchase flow, so there is no double-purchase path.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Text, XStack, YStack, View, ExpandingLineButton, useToastController } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import { store$, applySubscriptionTierFromServer } from 'app/state/store'
import { setStoredReceipt } from 'app/state/billing'
import { validateReceipt } from 'app/utils/billing/subscriptionApi'
import { extractStripeSessionIdFromSuccessUrl } from 'app/utils/billing/stripeCheckout'
import { shouldShowExternalLinkSurface } from 'app/utils/billing/externalLinkVisibility'
import { BillingDisclosure } from './BillingDisclosure'
import { attemptPurchase } from './purchaseFlow'
import { resolvePurchasePlatform, resolveStorefrontCountryCode } from './storefront'

type SurfaceState = 'idle' | 'purchasing' | 'purchased' | 'error'

// The warm error indicator draws from the active theme (never a fixed red).
const ERROR_DOT_COLOR = '$color9'

/**
 * Reads the external-billing feature flag defensively (never throws). The flag
 * is a server-seeded static config, so a plain read at render is sufficient and
 * avoids assuming a fully-materialized preferences node.
 */
function readExternalBillingFlag(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: any = (store$ as any)?.profile?.preferences?.feature_flags
      ?.external_billing_link_enabled
    const value = node && typeof node.get === 'function' ? node.get() : undefined
    return value ?? false
  } catch {
    return false
  }
}

export function PaidTierPurchaseSurface() {
  const router = useRouter()
  const toast = useToastController()

  const tier = (use$(store$.profile.subscription_tier) as string | undefined) ?? 'free'
  const userId = use$(store$.session.userId) as string | null

  const [state, setState] = useState<SurfaceState>('idle')

  const isSubscribed = tier === 'paid_monthly' || tier === 'paid_yearly'

  const runPurchase = useCallback(async () => {
    if (!userId) return
    setState('purchasing')
    try {
      const attempt = await attemptPurchase(userId)

      if (attempt.status === 'cancelled') {
        // User-cancel is NOT an error — return to idle silently, no toast.
        setState('idle')
        return
      }

      const result = await validateReceipt(attempt.outcome)
      if (result.ok) {
        // Persist the (Stripe cs_... / native) receipt for app-open re-validation.
        setStoredReceipt(attempt.outcome)
        applySubscriptionTierFromServer(result.subscription_tier)
        setState('purchased')
        return
      }

      // Validation failure — calm, generic, no owner/account leak. The same
      // message covers every failure code (including 409 ownership conflict).
      toast.show('That subscription could not be applied', {
        message: 'Please try again.',
      })
      setState('error')
    } catch {
      // An unexpected throw from the purchase or validation legs (e.g. the
      // checkout-URL builder rejecting a non-conforming id, or `new URL()` on a
      // malformed payment-link) would otherwise leave the surface stuck in the
      // disabled `purchasing` state with an unhandled rejection. Surface the
      // same calm generic message and drop to the error state so Retry engages.
      toast.show('That subscription could not be applied', {
        message: 'Please try again.',
      })
      setState('error')
    }
  }, [userId, toast])

  // On the Stripe (web/desktop) success return leg the user lands back on the
  // surface at `?session_id=cs_...` — auto-drive the validate → purchased flow
  // (reusing the Subscribe code path, including its error handling) so they
  // never have to press Subscribe a second time. Guarded so it fires at most
  // once, only when a session is known, and never when already subscribed.
  const autoValidateStartedRef = useRef(false)
  useEffect(() => {
    if (isSubscribed) return
    if (autoValidateStartedRef.current) return
    if (typeof window === 'undefined') return
    if (!userId) return
    const sessionId = extractStripeSessionIdFromSuccessUrl(window.location.href)
    if (!sessionId) return
    autoValidateStartedRef.current = true
    void runPurchase()
  }, [isSubscribed, userId, runPurchase])

  // ── Already-subscribed — no purchase flow, no upgrade pressure ──────────────
  if (isSubscribed) {
    return (
      <YStack
        gap="$5"
        padding="$5"
        maxWidth={560}
        width="100%"
      >
        <Text
          tag="h1"
          fontFamily="$journal"
          fontSize="$8"
          $sm={{ fontSize: '$7' }}
          color="$color"
        >
          You're already subscribed.
        </Text>
        <ExpandingLineButton
          onPress={() => router.push('/settings')}
          accessibilityLabel="View billing settings"
        >
          View billing settings
        </ExpandingLineButton>
      </YStack>
    )
  }

  // ── Purchased — confirmation + Done ─────────────────────────────────────────
  if (state === 'purchased') {
    return (
      <YStack
        gap="$5"
        padding="$5"
        maxWidth={560}
        width="100%"
      >
        <YStack
          gap="$3"
          aria-live="polite"
          role="status"
        >
          <Text
            tag="h1"
            fontFamily="$journal"
            fontSize="$8"
            $sm={{ fontSize: '$7' }}
            color="$color"
          >
            Thanks. Everything's unlocked.
          </Text>
        </YStack>
        <ExpandingLineButton
          size="cta"
          onPress={() => router.push('/settings')}
          accessibilityLabel="Done"
        >
          Done
        </ExpandingLineButton>
      </YStack>
    )
  }

  const isPurchasing = state === 'purchasing'
  const isError = state === 'error'

  const platform = resolvePurchasePlatform()
  const showExternalLink = shouldShowExternalLinkSurface(
    platform,
    resolveStorefrontCountryCode(),
    readExternalBillingFlag()
  )

  // ── Idle / purchasing / error ───────────────────────────────────────────────
  return (
    <YStack
      gap="$5"
      padding="$5"
      maxWidth={560}
      width="100%"
    >
      <Text
        tag="h1"
        fontFamily="$journal"
        fontSize="$8"
        $sm={{ fontSize: '$7' }}
        color="$color"
      >
        Unlock every theme
      </Text>

      <YStack gap="$2">
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color8"
        >
          Instantly unlock every cosmetic theme
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color8"
        >
          A higher AI quota when AI features arrive
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color8"
        >
          Support an indie product
        </Text>
      </YStack>

      <YStack gap="$1">
        <Text
          fontFamily="$journal"
          fontSize="$6"
          color="$color"
        >
          $4.99 / month
        </Text>
        <Text
          fontFamily="$journal"
          fontSize="$6"
          color="$color"
        >
          $39.99 / year
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color8"
        >
          33% saving on twelve monthly payments
        </Text>
      </YStack>

      <BillingDisclosure />

      {isError && (
        <XStack
          gap="$2"
          alignItems="center"
          aria-live="polite"
          role="status"
        >
          <View
            testID="billing-error-dot"
            width={8}
            height={8}
            borderRadius={2}
            backgroundColor={ERROR_DOT_COLOR}
          />
          <Text
            fontFamily="$body"
            fontSize="$3"
            color="$color11"
          >
            That didn't go through.
          </Text>
        </XStack>
      )}

      {isError ? (
        <ExpandingLineButton
          size="cta"
          onPress={runPurchase}
          accessibilityLabel="Retry"
        >
          Retry
        </ExpandingLineButton>
      ) : (
        <ExpandingLineButton
          size="cta"
          disabled={isPurchasing}
          onPress={runPurchase}
          accessibilityLabel="Subscribe"
        >
          Subscribe
        </ExpandingLineButton>
      )}

      {showExternalLink && (
        <ExpandingLineButton
          onPress={() => {
            // Native external-link management flow (Apple disclosure sheet /
            // Google External Offers). Wired with the native billing module.
          }}
          accessibilityLabel="Manage your subscription on the web"
        >
          Manage your subscription on the web
        </ExpandingLineButton>
      )}
    </YStack>
  )
}
