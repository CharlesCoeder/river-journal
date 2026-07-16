/**
 * Red-phase unit tests for the moderation-receipt data layer.
 *
 * Red-phase contract: every test in this file MUST fail until the target
 * modules exist —
 *   - `useMyActiveSuspension` added to `app/state/collective/suspension.ts`
 *   - new `app/state/collective/moderationReceipts.ts` exporting
 *     `useMyRemovedPosts`
 *   - new `app/features/moderation-receipts/acknowledgment.ts` exporting
 *     `hasAcknowledgedReceipt`, `acknowledgeReceipt`, `removedPostReceiptId`,
 *     `suspensionReceiptId`
 * — per this repo's established red-phase convention (see
 * `suspension.test.ts`, `moderation.test.ts`, `hasAcknowledgedBoundaryA.test.ts`).
 *
 * Surface covered:
 *   1. useMyActiveSuspension — own-SELECT query shape
 *      (`.from('user_suspensions').select(...).eq('user_id', userId)
 *      .gt('ends_at', <nowIso>).order('ends_at', {ascending:false})
 *      .limit(1).maybeSingle()`), queryKey, staleTime, enabled, row-or-null.
 *   2. useMyRemovedPosts — `supabase.rpc('collective_my_removed_posts',
 *      { max_rows: 50 })` query shape, queryKey, staleTime, enabled.
 *   3. receiptId builders — stability keyed on the RAW `removed_at` string
 *      (never a reformatted/reparsed date).
 *   4. acknowledgeReceipt / hasAcknowledgedReceipt — idempotent Legend-State
 *      preferences writes (mirrors `completeOnboarding`'s guard).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants ───────────────────────────────────────────────────────────
const COLLECTIVE_DIR = path.resolve(__dirname, '..')
const SUSPENSION_PATH = path.join(COLLECTIVE_DIR, 'suspension.ts')
const MODERATION_RECEIPTS_STATE_PATH = path.join(COLLECTIVE_DIR, 'moderationReceipts.ts')
const ACKNOWLEDGMENT_PATH = path.resolve(
  __dirname,
  '../../../features/moderation-receipts/acknowledgment.ts'
)

// ─── Supabase mock — hoisted rpc + chainable from() mock ──────────────────────
const { rpcMock, fromMock } = vi.hoisted(() => {
  const rpcMock = vi.fn()
  const fromMock = vi.fn()
  return { rpcMock, fromMock }
})

vi.mock('app/utils/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-test-123' } } },
        error: null,
      }),
    },
  },
}))

vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-test-123' } } },
        error: null,
      }),
    },
  },
}))

// ─── useQuery mock — inspect hook config without React renderer ───────────────
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

// ─── Chainable supabase.from(...) mock builder for user_suspensions own-read ──
// Mirrors `.from('user_suspensions').select(...).eq('user_id', userId)
// .gt('ends_at', nowIso).order('ends_at', {ascending:false}).limit(1).maybeSingle()`.
function makeFromChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const gt = vi.fn((_column?: unknown, _value?: unknown) => ({ order }))
  const eq = vi.fn(() => ({ gt }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, select, eq, gt, order, limit, maybeSingle }
}

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  useQueryMock.mockReset()
})

// =============================================================================
// 1. useMyActiveSuspension — own-SELECT hook (added to suspension.ts)
// =============================================================================

describe('useMyActiveSuspension — module surface', () => {
  it('suspension.ts exists', () => {
    expect(existsSync(SUSPENSION_PATH)).toBe(true)
  })

  it('exports useMyActiveSuspension as a named function', async () => {
    const mod = await import('../suspension')
    expect(typeof mod.useMyActiveSuspension).toBe('function')
  })

  it('suspension.ts still does NOT contain @legendapp/state import after the addition (D7 boundary)', () => {
    expect(existsSync(SUSPENSION_PATH)).toBe(true)
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('suspension.ts still does NOT call use$()', () => {
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })
})

describe('useMyActiveSuspension — own-SELECT query shape', () => {
  it('calls supabase.from("user_suspensions") with select/eq/gt/order/limit/maybeSingle chain', async () => {
    const chain = makeFromChain({ data: null, error: null })
    fromMock.mockReturnValue({ select: chain.select })
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    useMyActiveSuspension('user-abc')

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    await opts.queryFn()

    expect(fromMock).toHaveBeenCalledWith('user_suspensions')
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('ends_at'))
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-abc')
    expect(chain.order).toHaveBeenCalledWith('ends_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(1)
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('filters with .gt("ends_at", <ISO string near now>) — the server-side active-suspension guard', async () => {
    const chain = makeFromChain({ data: null, error: null })
    fromMock.mockReturnValue({ select: chain.select })
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    useMyActiveSuspension('user-abc')
    const opts = useQueryMock.mock.calls[0]![0]

    const before = Date.now()
    await opts.queryFn()
    const after = Date.now()

    expect(chain.gt).toHaveBeenCalledTimes(1)
    const [column, isoArg] = chain.gt.mock.calls[0]!
    expect(column).toBe('ends_at')
    expect(typeof isoArg).toBe('string')
    const parsed = new Date(isoArg as string).getTime()
    // The "now" passed to .gt() must be a genuinely current timestamp, not a
    // stale/hardcoded value — bracket it against the call's real wall-clock window.
    expect(parsed).toBeGreaterThanOrEqual(before - 1000)
    expect(parsed).toBeLessThanOrEqual(after + 1000)
  })

  it('returns the row when maybeSingle resolves one', async () => {
    const row = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: '2026-08-01T00:00:00.000Z',
      reason: 'harassment',
    }
    const chain = makeFromChain({ data: row, error: null })
    fromMock.mockReturnValue({ select: chain.select })
    useQueryMock.mockReturnValue({ data: row })

    const { useMyActiveSuspension } = await import('../suspension')
    const result = useMyActiveSuspension('user-abc')
    expect(result).toEqual(row)
  })

  it('returns null when there is no active suspension row', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    const result = useMyActiveSuspension('user-abc')
    expect(result).toBeNull()
  })

  it('queryKey is ["collective", "suspension", userId, "activeRow"]', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    useQueryMock.mockReset()
    useMyActiveSuspension('user-key-test')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(['collective', 'suspension', 'user-key-test', 'activeRow'])
  })

  it('staleTime is 60_000', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    useQueryMock.mockReset()
    useMyActiveSuspension('user-abc')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(60_000)
  })

  it('is disabled (enabled:false) and does not touch supabase.from when userId is null', async () => {
    useQueryMock.mockReturnValue({ data: null })

    const { useMyActiveSuspension } = await import('../suspension')
    useQueryMock.mockReset()
    useMyActiveSuspension(null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

// =============================================================================
// 2. useMyRemovedPosts — new state/collective/moderationReceipts.ts
// =============================================================================

describe('useMyRemovedPosts — module surface', () => {
  it('state/collective/moderationReceipts.ts exists', () => {
    expect(existsSync(MODERATION_RECEIPTS_STATE_PATH)).toBe(true)
  })

  it('exports useMyRemovedPosts as a named function', async () => {
    const mod = await import('../moderationReceipts')
    expect(typeof mod.useMyRemovedPosts).toBe('function')
  })

  it('does NOT contain @legendapp/state import (D7 boundary)', () => {
    expect(existsSync(MODERATION_RECEIPTS_STATE_PATH)).toBe(true)
    const src = readFileSync(MODERATION_RECEIPTS_STATE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state(?:\/[\w-]+(?:\/[\w-]+)?)?/)
  })

  it('does NOT call use$()', () => {
    const src = readFileSync(MODERATION_RECEIPTS_STATE_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })

  it('does NOT import from app/state/store', () => {
    const src = readFileSync(MODERATION_RECEIPTS_STATE_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})

describe('useMyRemovedPosts — RPC query shape', () => {
  it('queryFn calls supabase.rpc("collective_my_removed_posts", { max_rows: 50 })', async () => {
    useQueryMock.mockReturnValue({ data: [] })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    useMyRemovedPosts('user-abc')

    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(typeof opts.queryFn).toBe('function')

    rpcMock.mockResolvedValueOnce({ data: [], error: null })
    await opts.queryFn()

    expect(rpcMock).toHaveBeenCalledWith('collective_my_removed_posts', { max_rows: 50 })
  })

  it('queryKey is ["collective", "moderationReceipts", "removedPosts", userId]', async () => {
    useQueryMock.mockReturnValue({ data: [] })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    useQueryMock.mockReset()
    useMyRemovedPosts('user-key-test')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual([
      'collective',
      'moderationReceipts',
      'removedPosts',
      'user-key-test',
    ])
  })

  it('staleTime is 60_000', async () => {
    useQueryMock.mockReturnValue({ data: [] })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    useQueryMock.mockReset()
    useMyRemovedPosts('user-abc')

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.staleTime).toBe(60_000)
  })

  it('is disabled (enabled:false) and does not call the RPC when userId is null', async () => {
    useQueryMock.mockReturnValue({ data: [] })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    useQueryMock.mockReset()
    useMyRemovedPosts(null)

    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.enabled).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('surfaces the RPC rows array as returned data', async () => {
    const rows = [
      {
        id: 'post-1',
        parent_post_id: null,
        created_at: '2026-07-01T00:00:00.000Z',
        removed_reason: 'spam',
        removed_at: '2026-07-02T00:00:00.000Z',
      },
    ]
    useQueryMock.mockReturnValue({ data: rows })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    const result = useMyRemovedPosts('user-abc')
    expect(result).toEqual({ data: rows })
  })

  it('queryFn throws when the RPC returns a PostgrestError', async () => {
    useQueryMock.mockReturnValue({ data: undefined })

    const { useMyRemovedPosts } = await import('../moderationReceipts')
    useQueryMock.mockReset()
    useMyRemovedPosts('user-error')

    const opts = useQueryMock.mock.calls[0]![0]
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom', code: '42501', details: null, hint: null },
    })
    await expect(opts.queryFn()).rejects.toBeDefined()
  })
})

// =============================================================================
// 3. receiptId builders — RAW removed_at string stability
// =============================================================================

describe('receiptId builders — module surface', () => {
  it('acknowledgment.ts exists at the feature-layer path (NOT under state/collective)', () => {
    expect(existsSync(ACKNOWLEDGMENT_PATH)).toBe(true)
  })

  it('exports removedPostReceiptId and suspensionReceiptId', async () => {
    const mod = await import('../../../features/moderation-receipts/acknowledgment')
    expect(typeof mod.removedPostReceiptId).toBe('function')
    expect(typeof mod.suspensionReceiptId).toBe('function')
  })
})

describe('removedPostReceiptId — RAW removed_at, never reformatted', () => {
  it('builds "removed_post:<postId>:<removedAt>" verbatim', async () => {
    const { removedPostReceiptId } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    expect(removedPostReceiptId('post-42', '2026-07-10T12:00:00.000Z')).toBe(
      'removed_post:post-42:2026-07-10T12:00:00.000Z'
    )
  })

  it('preserves an atypical (but valid) raw ISO variant byte-for-byte — proves no Date round-trip reformatting happens', async () => {
    const { removedPostReceiptId } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    // If the implementation ever did `new Date(removedAt).toISOString()`, this
    // offset-form timestamp would be silently rewritten to a "Z"-suffixed UTC
    // form with a different clock digit — a stability regression the receipt
    // gate depends on never happening (AC: acknowledged receipts must not
    // re-surface because the key was built from a reformatted date).
    const rawWithOffset = '2026-07-10T08:00:00.000-04:00'
    const key = removedPostReceiptId('post-42', rawWithOffset)
    expect(key).toBe(`removed_post:post-42:${rawWithOffset}`)
    expect(key).not.toBe(`removed_post:post-42:${new Date(rawWithOffset).toISOString()}`)
  })

  it('two calls with the same raw removed_at produce the identical key (write/read stability)', async () => {
    const { removedPostReceiptId } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    const a = removedPostReceiptId('post-7', '2026-07-10T12:00:00.000Z')
    const b = removedPostReceiptId('post-7', '2026-07-10T12:00:00.000Z')
    expect(a).toBe(b)
  })

  it('a different removed_at (re-removal after reinstatement) yields a fresh key', async () => {
    const { removedPostReceiptId } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    const first = removedPostReceiptId('post-7', '2026-07-10T12:00:00.000Z')
    const second = removedPostReceiptId('post-7', '2026-08-01T09:30:00.000Z')
    expect(first).not.toBe(second)
  })
})

describe('suspensionReceiptId — builds "suspension:<id>"', () => {
  it('builds the expected key', async () => {
    const { suspensionReceiptId } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    expect(suspensionReceiptId('susp-99')).toBe('suspension:susp-99')
  })
})

// =============================================================================
// 4. acknowledgeReceipt / hasAcknowledgedReceipt — idempotent Legend-State writes
// =============================================================================

describe('acknowledgeReceipt / hasAcknowledgedReceipt', () => {
  let store$: typeof import('app/state/store').store$

  beforeEach(async () => {
    vi.resetModules()
    const storeModule = await import('app/state/store')
    store$ = storeModule.store$
    store$.profile.set(null)
  })

  it('hasAcknowledgedReceipt returns false when store$.profile is null', async () => {
    const { hasAcknowledgedReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    expect(hasAcknowledgedReceipt('removed_post:post-1:2026-07-01T00:00:00.000Z')).toBe(false)
  })

  it('hasAcknowledgedReceipt returns false when preferences.moderationReceipts is undefined (null-safe read)', async () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      preferences: {},
    } as any)
    const { hasAcknowledgedReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    expect(hasAcknowledgedReceipt('suspension:susp-1')).toBe(false)
  })

  it('acknowledgeReceipt writes a non-empty ISO acknowledged_at under preferences.moderationReceipts.<receiptId>', async () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
    } as any)
    const { acknowledgeReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    acknowledgeReceipt('removed_post:post-1:2026-07-01T00:00:00.000Z')

    const acknowledgedAt = (store$.profile as any).preferences?.moderationReceipts?.[
      'removed_post:post-1:2026-07-01T00:00:00.000Z'
    ]?.acknowledged_at?.get?.()
    expect(typeof acknowledgedAt).toBe('string')
    expect(new Date(acknowledgedAt).toISOString()).toBe(acknowledgedAt)
  })

  it('hasAcknowledgedReceipt returns true immediately after acknowledgeReceipt writes (synchronous read)', async () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
    } as any)
    const { acknowledgeReceipt, hasAcknowledgedReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    const receiptId = 'suspension:susp-42'
    expect(hasAcknowledgedReceipt(receiptId)).toBe(false)
    acknowledgeReceipt(receiptId)
    expect(hasAcknowledgedReceipt(receiptId)).toBe(true)
  })

  it('a second acknowledgeReceipt call on an already-acknowledged id is a no-op (idempotent — does not overwrite the first timestamp)', async () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
    } as any)
    const { acknowledgeReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    const receiptId = 'removed_post:post-9:2026-07-01T00:00:00.000Z'
    const firstNow = '2026-07-01T10:00:00.000Z'
    const secondNow = '2026-07-05T10:00:00.000Z'

    acknowledgeReceipt(receiptId, firstNow)
    acknowledgeReceipt(receiptId, secondNow)

    const acknowledgedAt = (store$.profile as any).preferences?.moderationReceipts?.[
      receiptId
    ]?.acknowledged_at?.get?.()
    expect(acknowledgedAt).toBe(firstNow)
    expect(acknowledgedAt).not.toBe(secondNow)
  })

  it('acknowledging one receiptId does not affect a different receiptId (independent keys, offline durability across a would-be force-quit)', async () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
    } as any)
    const { acknowledgeReceipt, hasAcknowledgedReceipt } = await import(
      '../../../features/moderation-receipts/acknowledgment'
    )
    acknowledgeReceipt('suspension:susp-1')
    expect(hasAcknowledgedReceipt('suspension:susp-1')).toBe(true)
    expect(hasAcknowledgedReceipt('suspension:susp-2')).toBe(false)
    expect(hasAcknowledgedReceipt('removed_post:post-1:2026-07-01T00:00:00.000Z')).toBe(false)
  })
})
