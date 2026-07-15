/**
 * subscriptionApi.ts — the client → Edge Function wrapper for receipt
 * validation, and the app-open opportunistic re-validation helper.
 *
 * This is the first client-invoked Edge Function call in the repo. It calls
 * `supabase.functions.invoke('subscription_validate_receipt', { body })`,
 * which auto-attaches the session JWT the function's gateway requires.
 *
 * Error surfacing is deliberate: on a non-2xx response the SDK resolves
 * `{ data: null, error }` where `error` is a `FunctionsHttpError` whose
 * `.message` is a fixed generic string — NOT the function's `{ error, code }`
 * body. The real status/code live on `error.context` (the raw Response):
 * `error.context.status` and `await error.context.json()`. A request that
 * never reached the function yields a `FunctionsFetchError` whose `.context`
 * is not a Response — guarded here so we fall back to a generic failure
 * rather than throw.
 *
 * `raw_receipt` is NEVER logged, thrown, or included in any returned value.
 */

import { supabase } from 'app/utils/supabase'
import type { SubscriptionTier } from 'app/state/streak'

export type BillingProvider = 'stripe' | 'apple_iap' | 'play_iap'

export interface ValidateReceiptRequest {
  provider: BillingProvider
  raw_receipt: string
}

export interface ValidateReceiptSuccess {
  ok: true
  subscription_tier: SubscriptionTier
  current_period_end: string
}

export interface ValidateReceiptFailure {
  ok: false
  status: number | null
  code: string | null
}

export type ValidateReceiptResult = ValidateReceiptSuccess | ValidateReceiptFailure

const GENERIC_FAILURE: ValidateReceiptFailure = { ok: false, status: null, code: null }

/**
 * Recovers the real `{ status, code }` from a non-2xx SDK error by reading the
 * raw Response the SDK attaches on `error.context`. Never reads `error.message`
 * (always the SDK's generic string). Returns a generic failure when the error
 * carries no usable Response context (e.g. a network-level FunctionsFetchError).
 */
async function extractFailure(error: unknown): Promise<ValidateReceiptFailure> {
  const context = (error as { context?: unknown } | null)?.context
  // A usable HTTP error context is a Response — it exposes a numeric `status`
  // and an async `json()`. FunctionsFetchError's context is the original
  // fetch error, which has neither.
  if (
    context &&
    typeof context === 'object' &&
    typeof (context as Response).status === 'number' &&
    typeof (context as Response).json === 'function'
  ) {
    const status = (context as Response).status
    try {
      const body = (await (context as Response).json()) as { code?: unknown }
      const code = typeof body?.code === 'string' ? body.code : null
      return { ok: false, status, code }
    } catch {
      // Unparseable body — still surface the status we recovered.
      return { ok: false, status, code: null }
    }
  }
  return GENERIC_FAILURE
}

export async function validateReceipt(
  request: ValidateReceiptRequest
): Promise<ValidateReceiptResult> {
  try {
    const { data, error } = await supabase.functions.invoke('subscription_validate_receipt', {
      body: { provider: request.provider, raw_receipt: request.raw_receipt },
    })

    if (error) {
      return await extractFailure(error)
    }

    if (data && data.ok === true) {
      return {
        ok: true,
        subscription_tier: data.subscription_tier as SubscriptionTier,
        current_period_end: data.current_period_end as string,
      }
    }

    return GENERIC_FAILURE
  } catch {
    // A hard throw (e.g. network down) — never leak the receipt, never rethrow.
    return GENERIC_FAILURE
  }
}

// ─── cancelSubscription — the wrapper around the cancel Edge Function ─────────
//
// Reuses the exact same error-extraction mechanics as validateReceipt (same
// `error.context.status` + `await error.context.json()` recovery, same
// `FunctionsFetchError` → generic-failure fallback). The success envelope
// carries `current_period_end` + `requires_native_action` and, unlike
// validateReceipt, NEVER a `subscription_tier`. `subscription_id`/`raw_receipt`
// never appear in any thrown, logged, or returned value.

export interface CancelSubscriptionRequest {
  provider: BillingProvider
  subscription_id: string
}

export interface CancelSubscriptionSuccess {
  ok: true
  current_period_end: string
  requires_native_action: boolean
}

// Reuse validateReceipt's failure shape verbatim.
export type CancelSubscriptionFailure = ValidateReceiptFailure

export type CancelSubscriptionResult = CancelSubscriptionSuccess | CancelSubscriptionFailure

export async function cancelSubscription(
  request: CancelSubscriptionRequest
): Promise<CancelSubscriptionResult> {
  try {
    const { data, error } = await supabase.functions.invoke('subscription_cancel', {
      body: { provider: request.provider, subscription_id: request.subscription_id },
    })

    if (error) {
      return await extractFailure(error)
    }

    if (data && data.ok === true) {
      return {
        ok: true,
        current_period_end: data.current_period_end as string,
        requires_native_action: data.requires_native_action === true,
      }
    }

    return GENERIC_FAILURE
  } catch {
    // A hard throw (e.g. network down) — never leak the subscription id, never rethrow.
    return GENERIC_FAILURE
  }
}

export interface StoredReceipt {
  provider: BillingProvider
  raw_receipt: string
}

export interface ReValidationRefresh {
  subscription_tier: SubscriptionTier
  current_period_end: string
}

/**
 * Fire-and-forget re-validation of a stored receipt on app open. Best-effort:
 * returns synchronously (never a Promise the boot path must await), no-ops when
 * there is no stored receipt, calls `onSuccess` only on a successful refresh,
 * and swallows every failure silently.
 */
export function reValidateStoredReceiptOnAppOpen(
  storedReceipt: StoredReceipt | null,
  onSuccess: (refresh: ReValidationRefresh) => void
): void {
  if (!storedReceipt) return

  void (async () => {
    try {
      const result = await validateReceipt(storedReceipt)
      if (result.ok) {
        onSuccess({
          subscription_tier: result.subscription_tier,
          current_period_end: result.current_period_end,
        })
      }
    } catch {
      // Silent — app-open re-validation must never surface an error.
    }
  })()
}
