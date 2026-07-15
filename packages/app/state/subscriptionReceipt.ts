// packages/app/state/subscriptionReceipt.ts
//
// Client-readable own-row read of `subscription_receipts` — the source of BOTH
// the cancel pair (`provider`, `provider_subscription_id`) and the Billing
// surface's display data (`status`, `current_period_end`).
//
// Mirrors `useMyActiveSuspension` (state/collective/suspension.ts): a TanStack
// `useQuery` own-row `.maybeSingle()` read with `enabled: userId !== null`,
// `staleTime: 60_000`. The table's `subscription_receipts_select_own_or_admin`
// RLS policy is the real guard; the `.eq('user_id', ...)` is convenience. There
// is NO client write path — reads only; the cancel Edge Function does the
// server-side write.
//
// This is deliberately kept Legend-State-free (unlike state/billing.ts) so the
// query hook stays a plain TanStack read.

import { useQuery } from '@tanstack/react-query'
import { supabase } from 'app/utils/supabase'
import type { BillingProvider } from 'app/utils/billing/subscriptionApi'

export type SubscriptionReceiptStatus = 'active' | 'pending' | 'canceled' | 'past_due' | 'expired'

export interface SubscriptionReceiptRow {
  provider: BillingProvider
  provider_subscription_id: string
  status: SubscriptionReceiptStatus
  current_period_end: string
}

/**
 * The caller's own subscription-receipt row (furthest-future period end among
 * live rows), or null if none exists yet (loading, or an unsynced apple/play
 * seam-stub state, or every row is 'expired').
 *
 * Expired rows are filtered out (`.neq('status', 'expired')`): a stale expired
 * row can carry a dead `sub_...` that would 404 the cancel Edge Function, and a
 * provider switch can leave an old expired row whose `current_period_end` is
 * still further-future than the live row — so it must not win the tiebreak. If
 * EVERY row is expired the read resolves null-like, which correctly shows no
 * cancel affordance (there is no live subscription to cancel).
 *
 * queryKey: ['billing', 'receipt', userId]
 * staleTime: 60_000
 * enabled: userId !== null
 */
export function useSubscriptionReceipt(userId: string | null): SubscriptionReceiptRow | null {
  const result = useQuery({
    queryKey: ['billing', 'receipt', userId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_receipts')
        .select('provider, provider_subscription_id, status, current_period_end')
        .eq('user_id', userId!)
        .neq('status', 'expired')
        .order('current_period_end', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as SubscriptionReceiptRow | null) ?? null
    },
    enabled: userId !== null,
    staleTime: 60_000,
  })

  return result?.data ?? null
}
