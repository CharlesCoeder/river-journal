/**
 * BillingSection — the Billing surface reachable from Settings.
 *
 * Renders, for a subscribed user, their current subscription status, their
 * formatted period-end date, and a "Cancel subscription" affordance that hosts
 * the CancelSubscriptionFlow locked Dialog. Self-contained: it reads
 * `store$.profile.subscription_tier` and `store$.session.userId` itself
 * (mirroring PaidTierPurchaseSurface's own internal userId read) and renders
 * null for a free-tier user (the SuspensionStatusSection self-null pattern).
 *
 * The display data — status, period end, provider, provider_subscription_id —
 * comes from the caller's OWN `subscription_receipts` row (read via
 * `useSubscriptionReceipt`, own-row RLS SELECT), NOT from `store$.profile`
 * (which only carries `subscription_tier`) and NOT from `billingReceipt$`
 * (which holds the Stripe `cs_...` re-validation id, not the cancelable
 * `sub_...`). If the paid-tier gate passes but the receipt hook resolves null
 * (an unsynced or seam-stub state), it shows a calm "syncing" line with NO
 * Cancel affordance — there is no (provider, subscription_id) pair to cancel
 * with. Once the receipt's status is already 'canceled', it shows the
 * "access continues until [date]" microcopy in place of the Cancel affordance.
 *
 * No early tier downgrade is ever written client-side — the period-end flip to
 * free is exclusively server-owned.
 */

import { useCallback, useState } from 'react'
import { Text, XStack, YStack, ExpandingLineButton } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { queryClient } from 'app/state/queryClient'
import { useSubscriptionReceipt } from 'app/state/subscriptionReceipt'
import { formatPeriodEnd } from 'app/utils/billing/formatPeriodEnd'
import { CancelSubscriptionFlow } from './CancelSubscriptionFlow'

export function BillingSection() {
  const tier = (use$(store$.profile.subscription_tier) as string | undefined) ?? 'free'
  const userId = use$(store$.session.userId) as string | null

  const receipt = useSubscriptionReceipt(userId)
  const [cancelOpen, setCancelOpen] = useState(false)

  const handleCancelled = useCallback(() => {
    // Refetch the own-row receipt so the surface reflects status='canceled' +
    // the fresh current_period_end. No client-side tier write — the flip to
    // free at period end is server-owned.
    void queryClient.invalidateQueries({ queryKey: ['billing', 'receipt', userId] })
  }, [userId])

  const isSubscribed = tier === 'paid_monthly' || tier === 'paid_yearly'
  if (!isSubscribed) return null

  const isCanceled = receipt?.status === 'canceled'
  const formattedPeriodEnd = formatPeriodEnd(receipt?.current_period_end)

  return (
    <YStack gap="$4">
      <Text
        fontFamily="$body"
        fontSize={11}
        textTransform="uppercase"
        letterSpacing={2}
        color="$color8"
      >
        Billing
      </Text>
      {receipt === null ? (
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color8"
        >
          Subscription details are syncing.
        </Text>
      ) : isCanceled ? (
        <YStack gap="$2">
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$color"
          >
            {formattedPeriodEnd
              ? `Your access continues until ${formattedPeriodEnd}`
              : 'Your access continues until the end of your current billing period'}
          </Text>
        </YStack>
      ) : (
        <YStack gap="$2">
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$color"
          >
            {`Status: ${receipt.status}`}
          </Text>
          {formattedPeriodEnd ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              color="$color8"
            >
              {receipt.status === 'active'
                ? `Renews ${formattedPeriodEnd}`
                : `Current period ends ${formattedPeriodEnd}`}
            </Text>
          ) : null}
          <XStack marginTop="$2">
            <ExpandingLineButton
              size="default"
              onPress={() => setCancelOpen(true)}
              accessibilityLabel="Cancel subscription"
            >
              Cancel subscription
            </ExpandingLineButton>
          </XStack>
        </YStack>
      )}

      {/*
        The dialog owns its own terminal lifecycle. Once it is open we keep it
        mounted even if the post-cancel receipt refetch flips `isCanceled` to
        true — otherwise the terminal "Cancelled. Thanks for being here." + Done
        acknowledgment would be preempted mid-flow. It only unmounts once the
        dialog itself closes (`onOpenChange(false)` resets `cancelOpen`), at
        which point the "access continues" microcopy takes over. The
        `receipt !== null` guard stays so the flow always has a real
        (provider, subscription_id) pair to render.
      */}
      {receipt !== null && (cancelOpen || !isCanceled) ? (
        <CancelSubscriptionFlow
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          provider={receipt.provider}
          subscriptionId={receipt.provider_subscription_id}
          currentPeriodEnd={receipt.current_period_end}
          onCancelled={handleCancelled}
        />
      ) : null}
    </YStack>
  )
}

export default BillingSection
