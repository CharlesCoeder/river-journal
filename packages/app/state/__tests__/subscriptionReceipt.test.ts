/**
 * subscriptionReceipt.test.ts — the client-readable own-row read of
 * `subscription_receipts`, the source of BOTH the cancel pair
 * (`provider`, `provider_subscription_id`) and the Billing surface's display
 * data (`status`, `current_period_end`).
 *
 * Contract pinned for the green-phase implementer (mirrors
 * `useMyActiveSuspension` in `state/collective/suspension.ts`):
 *   `packages/app/state/subscriptionReceipt.ts` exports
 *   `useSubscriptionReceipt(userId: string | null): SubscriptionReceiptRow | null`
 *   backed by a TanStack `useQuery` with:
 *     queryKey: ['billing', 'receipt', userId]
 *     queryFn: supabase.from('subscription_receipts')
 *       .select('provider, provider_subscription_id, status, current_period_end')
 *       .eq('user_id', userId)
 *       .neq('status', 'expired')
 *       .order('current_period_end', { ascending: false })
 *       .limit(1)
 *       .maybeSingle()
 *     enabled: userId !== null
 *     staleTime: 60_000
 *
 * The `.neq('status', 'expired')` filter deprioritizes stale expired rows: a
 * stale expired row can carry a dead `sub_...` that 404s the cancel, and a
 * provider switch can leave an old expired row with a further-future
 * `current_period_end` that would otherwise win the desc tiebreak. When every
 * row is expired the read resolves null-like (no cancel affordance).
 *
 * Mock strategy mirrors `state/collective/__tests__/suspension.test.ts`:
 * `useQuery` is mocked directly so the hook config (queryKey/enabled/
 * staleTime/queryFn) is inspectable without a React renderer, and the
 * Supabase query-builder chain is a hoisted spy chain.
 *
 * Red-phase: `packages/app/state/subscriptionReceipt.ts` does not exist yet —
 * this file fails at the top-level import until it is created.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Supabase query-builder chain mock — hoisted before SUT import ──────────
const { fromMock, selectMock, eqMock, neqMock, orderMock, limitMock, maybeSingleMock } = vi.hoisted(
  () => {
    const maybeSingleMock = vi.fn()
    const limitMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const orderMock = vi.fn(() => ({ limit: limitMock }))
    const neqMock = vi.fn(() => ({ order: orderMock }))
    const eqMock = vi.fn(() => ({ neq: neqMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    const fromMock = vi.fn(() => ({ select: selectMock }))
    return { fromMock, selectMock, eqMock, neqMock, orderMock, limitMock, maybeSingleMock }
  }
)

vi.mock('app/utils/supabase', () => ({
  supabase: { from: fromMock },
}))

// ─── useQuery mock — inspect hook config without a React renderer ──────────
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

beforeEach(() => {
  fromMock.mockClear()
  selectMock.mockClear()
  eqMock.mockClear()
  neqMock.mockClear()
  orderMock.mockClear()
  limitMock.mockClear()
  maybeSingleMock.mockReset()
  useQueryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useSubscriptionReceipt — queryKey shape', () => {
  it('queryKey is ["billing", "receipt", userId]', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useSubscriptionReceipt('user-abc')

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['billing', 'receipt', 'user-abc'])
  })

  it('queryKey includes null userId when passed null', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt(null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['billing', 'receipt', null])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useSubscriptionReceipt — enabled gate', () => {
  it('enabled is false when userId is null (no own-row to read)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt(null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
  })

  it('enabled is true when userId is a non-null string', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-abc')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(true)
  })

  it('does not touch the Supabase client at all when disabled (queryFn never invoked)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useSubscriptionReceipt(null)

    expect(fromMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useSubscriptionReceipt — staleTime', () => {
  it('staleTime is 60_000 (60 seconds)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-abc')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(60_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useSubscriptionReceipt — queryFn reads the own row via the correct chain', () => {
  it("selects provider, provider_subscription_id, status, current_period_end scoped to the caller's own row", async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-abc')

    const opts = useQueryMock.mock.calls[0]![0]
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        provider: 'stripe',
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: '2026-08-14T00:00:00Z',
      },
      error: null,
    })

    const result = await opts.queryFn()

    expect(fromMock).toHaveBeenCalledWith('subscription_receipts')
    expect(selectMock).toHaveBeenCalledWith(
      'provider, provider_subscription_id, status, current_period_end'
    )
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-abc')
    expect(neqMock).toHaveBeenCalledWith('status', 'expired')
    expect(orderMock).toHaveBeenCalledWith('current_period_end', { ascending: false })
    expect(limitMock).toHaveBeenCalledWith(1)
    expect(result).toEqual({
      provider: 'stripe',
      provider_subscription_id: 'sub_123',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
    })
  })

  it("deprioritizes expired rows via .neq('status', 'expired') so a stale dead sub_... can't win the tiebreak", async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-provider-switch')

    const opts = useQueryMock.mock.calls[0]![0]
    // A live 'canceled' row wins because the expired row is filtered out at the
    // query level — even if the expired row carried a further-future period end.
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        provider: 'stripe',
        provider_subscription_id: 'sub_live',
        status: 'canceled',
        current_period_end: '2026-08-14T00:00:00Z',
      },
      error: null,
    })

    const result = await opts.queryFn()

    // The expired filter is applied between the own-row scope and the ordering.
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-provider-switch')
    expect(neqMock).toHaveBeenCalledWith('status', 'expired')
    expect(result).toEqual({
      provider: 'stripe',
      provider_subscription_id: 'sub_live',
      status: 'canceled',
      current_period_end: '2026-08-14T00:00:00Z',
    })
  })

  it('resolves null when every row is expired (the filter leaves no candidate — no cancel affordance)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-all-expired')

    const opts = useQueryMock.mock.calls[0]![0]
    // With `.neq('status', 'expired')`, an all-expired user yields no matching
    // row, so maybeSingle returns null data → the hook resolves null-like.
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })

    const result = await opts.queryFn()

    expect(neqMock).toHaveBeenCalledWith('status', 'expired')
    expect(result).toBeNull()
  })

  it('resolves null when no row is found (maybeSingle returns null data)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-no-receipt')

    const opts = useQueryMock.mock.calls[0]![0]
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })

    const result = await opts.queryFn()
    expect(result).toBeNull()
  })

  it('throws when the query errors (TanStack surfaces it as a query error, never swallowed)', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    useQueryMock.mockReset()
    useSubscriptionReceipt('user-error')

    const opts = useQueryMock.mock.calls[0]![0]
    const pgError = { message: 'permission denied', code: '42501', details: null, hint: null }
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: pgError })

    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useSubscriptionReceipt — return value', () => {
  it('returns the row when the query has data', async () => {
    const row = {
      provider: 'apple_iap' as const,
      provider_subscription_id: '1000000123456789',
      status: 'active' as const,
      current_period_end: '2026-09-01T00:00:00Z',
    }
    useQueryMock.mockReturnValue({ data: row })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    const result = useSubscriptionReceipt('user-abc')
    expect(result).toEqual(row)
  })

  it('returns null when the query has no data yet (loading or empty)', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useSubscriptionReceipt } = await import('../subscriptionReceipt')
    const result = useSubscriptionReceipt('user-abc')
    expect(result).toBeNull()
  })
})
