/**
 * subscriptionApi.test.ts — the client subscription API wrapper, the first
 * client -> Edge Function call in the repo, plus the app-open opportunistic
 * re-validation helper.
 *
 * `validateReceipt({ provider, raw_receipt })` calls
 * `supabase.functions.invoke('subscription_validate_receipt', { body })`.
 * Error surfacing is verified against the installed `@supabase/functions-js`:
 *   - success: `{ data: { ok: true, subscription_tier, current_period_end },
 *     error: null }` -> the wrapper resolves `{ ok: true, subscription_tier,
 *     current_period_end }`.
 *   - non-2xx: `{ data: null, error: FunctionsHttpError }` whose `.message`
 *     is always the SDK's fixed generic string — the wrapper MUST read
 *     `error.context.status` + `await error.context.json()` (the raw
 *     Response) to recover the real `{ error, code }` / status, NEVER
 *     `error.message`/`error.code`.
 *   - network-level failure (request never reached the function):
 *     `FunctionsFetchError`, whose `.context` is NOT a Response (no `.json()`
 *     method) — the wrapper must guard this and fall back to a generic
 *     failure rather than throwing on `.context.json()` of a non-Response.
 *   - `raw_receipt` must NEVER appear in any thrown/logged value.
 *
 * `reValidateStoredReceiptOnAppOpen(storedReceipt, onSuccess)` — the app-open
 * re-validation helper. Its fire-and-forget / silent-failure / non-blocking
 * contract is independently testable regardless of the call site it is
 * ultimately invoked from:
 *   - no-ops synchronously (never calls invoke) when storedReceipt is null.
 *   - returns `undefined` synchronously (never a Promise the caller must
 *     await) — the fire-and-forget shape the story requires ("never
 *     awaited on the boot path").
 *   - calls `onSuccess({ subscription_tier, current_period_end })` on a
 *     successful re-validation.
 *   - swallows a failed re-validation SILENTLY: no throw, no rejection, and
 *     onSuccess is never called.
 *
 * Red-phase: `packages/app/utils/billing/subscriptionApi.ts` does not exist
 * yet — this file fails at the top-level import until it is created.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/functions-js'

// ─── Supabase mock — hoisted before SUT import ────────────────────────────────
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('app/utils/supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}))

// Import under test — fails until subscriptionApi.ts exists.
import {
  validateReceipt,
  reValidateStoredReceiptOnAppOpen,
  cancelSubscription,
} from '../subscriptionApi'

function httpErrorWithBody(status: number, body: Record<string, unknown>) {
  const response = new Response(JSON.stringify(body), { status })
  return new FunctionsHttpError(response)
}

beforeEach(() => {
  invokeMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validateReceipt — invocation contract', () => {
  it('calls supabase.functions.invoke with the exact function name and body', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        subscription_tier: 'paid_monthly',
        current_period_end: '2026-08-14T00:00:00Z',
      },
      error: null,
    })

    await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(invokeMock).toHaveBeenCalledWith('subscription_validate_receipt', {
      body: { provider: 'stripe', raw_receipt: 'cs_test_123' },
    })
  })

  it('resolves the success envelope verbatim on a 200 response', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        subscription_tier: 'paid_yearly',
        current_period_end: '2027-07-14T00:00:00Z',
      },
      error: null,
    })

    const result = await validateReceipt({ provider: 'apple_iap', raw_receipt: 'receipt-blob' })

    expect(result).toEqual({
      ok: true,
      subscription_tier: 'paid_yearly',
      current_period_end: '2027-07-14T00:00:00Z',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validateReceipt — error extraction from FunctionsHttpError.context', () => {
  it('extracts a 401 unauthorized from error.context, never from error.message', async () => {
    const httpError = httpErrorWithBody(401, { error: 'unauthorized', code: 'unauthorized' })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('unauthorized')
    }
  })

  it('extracts a 400 bad_request', async () => {
    const httpError = httpErrorWithBody(400, {
      error: 'unsupported or missing provider',
      code: 'bad_request',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toBe('bad_request')
    }
  })

  it('extracts a 409 receipt_ownership_conflict', async () => {
    const httpError = httpErrorWithBody(409, {
      error: 'subscription could not be applied to this account',
      code: 'receipt_ownership_conflict',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('receipt_ownership_conflict')
    }
  })

  it('extracts a 502 provider_contract_violation', async () => {
    const httpError = httpErrorWithBody(502, {
      error: 'provider contract violation',
      code: 'provider_contract_violation',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'play_iap', raw_receipt: 'token-blob' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.code).toBe('provider_contract_violation')
    }
  })

  it('extracts a 500 internal', async () => {
    const httpError = httpErrorWithBody(500, {
      error: 'receipt validation failed',
      code: 'internal',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.code).toBe('internal')
    }
  })

  it('never reads error.message/error.code for the surfaced status/code (SDK generic string trap)', async () => {
    // error.message is ALWAYS the SDK's fixed generic string, never the real
    // code — a wrapper that naively read it would surface the wrong value.
    const httpError = httpErrorWithBody(409, { error: 'x', code: 'receipt_ownership_conflict' })
    expect(httpError.message).toBe('Edge Function returned a non-2xx status code')
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Must NOT be the SDK's generic message/undefined code.
      expect(result.code).toBe('receipt_ownership_conflict')
      expect(result.code).not.toBe('Edge Function returned a non-2xx status code')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validateReceipt — network-level failure guard', () => {
  it('falls back to a generic failure on a FunctionsFetchError (no Response .context) without throwing', async () => {
    const fetchError = new FunctionsFetchError(new TypeError('Failed to fetch'))
    invokeMock.mockResolvedValue({ data: null, error: fetchError })

    await expect(
      validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })
    ).resolves.not.toThrow()

    const result = await validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })
    expect(result.ok).toBe(false)
  })

  it('never throws even when error.context is missing/unparseable', async () => {
    // A pathological error shape with no usable context at all.
    invokeMock.mockResolvedValue({ data: null, error: { name: 'WeirdError', message: 'boom' } })

    await expect(
      validateReceipt({ provider: 'stripe', raw_receipt: 'cs_test_123' })
    ).resolves.toMatchObject({ ok: false })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validateReceipt — never leaks raw_receipt', () => {
  it('does not include raw_receipt in the returned failure value', async () => {
    const httpError = httpErrorWithBody(400, { error: 'bad', code: 'bad_request' })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await validateReceipt({
      provider: 'stripe',
      raw_receipt: 'super-secret-receipt-blob',
    })

    expect(JSON.stringify(result)).not.toContain('super-secret-receipt-blob')
  })

  it('does not console-log or console-error raw_receipt content on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const httpError = httpErrorWithBody(500, { error: 'internal', code: 'internal' })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    await validateReceipt({ provider: 'stripe', raw_receipt: 'super-secret-receipt-blob' })

    const allCalls = [...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls]
    const serialized = JSON.stringify(allCalls)
    expect(serialized).not.toContain('super-secret-receipt-blob')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('reValidateStoredReceiptOnAppOpen — app-open re-validation', () => {
  it('no-ops (never calls invoke) when there is no stored receipt', () => {
    const onSuccess = vi.fn()
    reValidateStoredReceiptOnAppOpen(null, onSuccess)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('returns undefined synchronously — fire-and-forget, never a Promise the boot path must await', () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        subscription_tier: 'paid_monthly',
        current_period_end: '2026-08-14T00:00:00Z',
      },
      error: null,
    })
    const onSuccess = vi.fn()
    const returnValue = reValidateStoredReceiptOnAppOpen(
      { provider: 'stripe', raw_receipt: 'cs_test_123' },
      onSuccess
    )
    expect(returnValue).toBeUndefined()
  })

  it('calls onSuccess with the refreshed tier/current_period_end when re-validation succeeds', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        subscription_tier: 'paid_yearly',
        current_period_end: '2027-01-01T00:00:00Z',
      },
      error: null,
    })
    const onSuccess = vi.fn()
    reValidateStoredReceiptOnAppOpen({ provider: 'stripe', raw_receipt: 'cs_test_123' }, onSuccess)

    // Fire-and-forget: allow the microtask queue to flush.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onSuccess).toHaveBeenCalledWith({
      subscription_tier: 'paid_yearly',
      current_period_end: '2027-01-01T00:00:00Z',
    })
  })

  it('re-POSTs the exact stored raw_receipt (the cs_... Session id for Stripe) unchanged', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        subscription_tier: 'paid_monthly',
        current_period_end: '2026-08-14T00:00:00Z',
      },
      error: null,
    })
    reValidateStoredReceiptOnAppOpen(
      { provider: 'stripe', raw_receipt: 'cs_test_should_not_change' },
      vi.fn()
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invokeMock).toHaveBeenCalledWith('subscription_validate_receipt', {
      body: { provider: 'stripe', raw_receipt: 'cs_test_should_not_change' },
    })
  })

  it('swallows a failed re-validation silently — never calls onSuccess, never throws/rejects', async () => {
    const httpError = httpErrorWithBody(409, {
      error: 'conflict',
      code: 'receipt_ownership_conflict',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })
    const onSuccess = vi.fn()

    expect(() =>
      reValidateStoredReceiptOnAppOpen(
        { provider: 'stripe', raw_receipt: 'cs_test_123' },
        onSuccess
      )
    ).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('swallows a hard network throw silently — never propagates an unhandled rejection', async () => {
    invokeMock.mockRejectedValue(new Error('network down'))
    const onSuccess = vi.fn()

    expect(() =>
      reValidateStoredReceiptOnAppOpen(
        { provider: 'stripe', raw_receipt: 'cs_test_123' },
        onSuccess
      )
    ).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onSuccess).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cancelSubscription — the wrapper around the cancel Edge Function.
//
// Reuses the exact same error-extraction mechanics as validateReceipt (same
// `error.context.status` + `await error.context.json()` recovery, same
// `FunctionsFetchError` -> generic-failure fallback). The success envelope
// carries `current_period_end` + `requires_native_action` and, unlike
// validateReceipt, NEVER a `subscription_tier`.
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelSubscription — invocation contract', () => {
  it('calls supabase.functions.invoke with the exact function name and body', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, current_period_end: '2026-08-14T00:00:00Z', requires_native_action: false },
      error: null,
    })

    await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(invokeMock).toHaveBeenCalledWith('subscription_cancel', {
      body: { provider: 'stripe', subscription_id: 'sub_test_123' },
    })
  })

  it('resolves the Stripe success envelope with requires_native_action: false', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, current_period_end: '2026-08-14T00:00:00Z', requires_native_action: false },
      error: null,
    })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result).toEqual({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })
  })

  it('resolves the apple_iap success envelope with requires_native_action: true', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, current_period_end: '2026-09-01T00:00:00Z', requires_native_action: true },
      error: null,
    })

    const result = await cancelSubscription({
      provider: 'apple_iap',
      subscription_id: '1000000123456789',
    })

    expect(result).toEqual({
      ok: true,
      current_period_end: '2026-09-01T00:00:00Z',
      requires_native_action: true,
    })
  })

  it('resolves the play_iap success envelope with requires_native_action: true', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, current_period_end: '2026-09-01T00:00:00Z', requires_native_action: true },
      error: null,
    })

    const result = await cancelSubscription({
      provider: 'play_iap',
      subscription_id: 'gpa.token.123',
    })

    expect(result).toEqual({
      ok: true,
      current_period_end: '2026-09-01T00:00:00Z',
      requires_native_action: true,
    })
  })

  it('never includes a subscription_tier field on the success result (cancel is tier-silent, unlike validate)', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, current_period_end: '2026-08-14T00:00:00Z', requires_native_action: false },
      error: null,
    })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result).not.toHaveProperty('subscription_tier')
  })
})

describe('cancelSubscription — error extraction from FunctionsHttpError.context', () => {
  it('extracts a 401 unauthorized from error.context, never from error.message', async () => {
    const httpError = httpErrorWithBody(401, { error: 'unauthorized', code: 'unauthorized' })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('unauthorized')
    }
  })

  it('extracts a 400 bad_request', async () => {
    const httpError = httpErrorWithBody(400, {
      error: 'missing or empty subscription_id',
      code: 'bad_request',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toBe('bad_request')
    }
  })

  it('extracts the generic 404 subscription_not_found (identical for "no row" and "foreign-owned row")', async () => {
    const httpError = httpErrorWithBody(404, {
      error: 'no active subscription found for this account',
      code: 'subscription_not_found',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({
      provider: 'stripe',
      subscription_id: 'sub_foreign_or_missing',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.code).toBe('subscription_not_found')
    }
  })

  it('extracts a 502 provider fault', async () => {
    const httpError = httpErrorWithBody(502, {
      error: 'provider cancellation failed',
      code: 'provider_fault',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.code).toBe('provider_fault')
    }
  })

  it('extracts a 500 internal', async () => {
    const httpError = httpErrorWithBody(500, {
      error: 'subscription cancellation failed',
      code: 'internal',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.code).toBe('internal')
    }
  })

  it('never reads error.message for the surfaced code (SDK generic string trap)', async () => {
    const httpError = httpErrorWithBody(404, {
      error: 'x',
      code: 'subscription_not_found',
    })
    expect(httpError.message).toBe('Edge Function returned a non-2xx status code')
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('subscription_not_found')
      expect(result.code).not.toBe('Edge Function returned a non-2xx status code')
    }
  })
})

describe('cancelSubscription — network-level failure guard', () => {
  it('falls back to a generic failure on a FunctionsFetchError without throwing', async () => {
    const fetchError = new FunctionsFetchError(new TypeError('Failed to fetch'))
    invokeMock.mockResolvedValue({ data: null, error: fetchError })

    await expect(
      cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })
    ).resolves.not.toThrow()

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })
    expect(result.ok).toBe(false)
  })

  it('never throws on a hard rejection from invoke (e.g. network down)', async () => {
    invokeMock.mockRejectedValue(new Error('network down'))

    await expect(
      cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('cancelSubscription — never leaks subscription_id / raw_receipt', () => {
  it('does not include subscription_id in the returned failure value', async () => {
    const httpError = httpErrorWithBody(404, {
      error: 'no active subscription found for this account',
      code: 'subscription_not_found',
    })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    const result = await cancelSubscription({
      provider: 'stripe',
      subscription_id: 'sub_should_never_leak_9999',
    })

    expect(JSON.stringify(result)).not.toContain('sub_should_never_leak_9999')
  })

  it('does not console-log or console-error the subscription_id on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const httpError = httpErrorWithBody(500, { error: 'internal', code: 'internal' })
    invokeMock.mockResolvedValue({ data: null, error: httpError })

    await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_should_never_leak_9999' })

    const allCalls = [...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls]
    const serialized = JSON.stringify(allCalls)
    expect(serialized).not.toContain('sub_should_never_leak_9999')
  })

  it('does not include a raw_receipt field in the success result', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        current_period_end: '2026-08-14T00:00:00Z',
        requires_native_action: false,
        raw_receipt: { should: 'never appear' },
      },
      error: null,
    })

    const result = await cancelSubscription({ provider: 'stripe', subscription_id: 'sub_test_123' })

    expect(result).not.toHaveProperty('raw_receipt')
  })
})
