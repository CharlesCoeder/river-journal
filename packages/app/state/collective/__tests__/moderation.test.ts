/**
 * TDD red-phase unit tests for `state/collective/moderation.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until the target
 * module (`app/state/collective/moderation.ts`) exists — the whole file
 * fails at the top-level `import('../moderation')` with a module-resolution
 * error, per this repo's established red-phase convention (see
 * `yourPosts.test.ts`).
 *
 * Surface covered:
 *   - `moderationQueueKey` deep-equals ['moderation', 'queue'] (as-const tuple).
 *   - `lastModerationActionKey` deep-equals ['moderation', 'lastAction'].
 *   - `fetchModerationQueue()` calls `supabase.rpc('collective_moderation_queue',
 *     { page_size: 100 })`, returns rows on success, returns [] on a null
 *     data payload (defensive default), and propagates/throws on error.
 *   - `useModerationQueue()` — a `useQuery` wrapper: queryKey, queryFn wired
 *     to `fetchModerationQueue`, refetchInterval === 30_000, staleTime ===
 *     25_000 (staleTime < refetchInterval — calm-realtime invariant),
 *     refetchOnWindowFocus === true.
 *   - `useLastModerationActionAt()` — a `useQuery` wrapper reading
 *     `moderation_actions` directly (admin SELECT is permitted here): queryKey,
 *     and its queryFn maps the latest row's `created_at` to a value, or to
 *     null when no moderation action exists yet.
 *
 * Mock strategy mirrors `state/collective/__tests__/yourPosts.test.ts`:
 * mock the supabase client module and mock `@tanstack/react-query`'s
 * `useQuery` so hook config can be asserted without mounting React.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the supabase client at module-top. Path is computed from
// `state/collective/__tests__/` -> `utils/supabase`.
vi.mock('../../../utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

// Mock @tanstack/react-query so we can assert the hook's config object
// without mounting a React renderer / QueryClientProvider.
const useQueryMock = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}))

// ─── Chainable supabase.from(...) mock builder ─────────────────────────────
// Mirrors the `.from('moderation_actions').select('created_at').order(...)
// .limit(1).maybeSingle()` call shape.
function makeFromChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ order }))
  const from = vi.fn(() => ({ select }))
  return { from, select, order, limit, maybeSingle }
}

beforeEach(() => {
  useQueryMock.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('moderationQueueKey / lastModerationActionKey shape', () => {
  it('exports moderationQueueKey deep-equal to ["moderation", "queue"]', async () => {
    const mod = await import('../moderation')
    expect(mod.moderationQueueKey).toEqual(['moderation', 'queue'])
  })

  it('moderationQueueKey is a 2-tuple (length === 2)', async () => {
    const mod = await import('../moderation')
    expect(mod.moderationQueueKey).toHaveLength(2)
  })

  it('exports lastModerationActionKey deep-equal to ["moderation", "lastAction"]', async () => {
    const mod = await import('../moderation')
    expect(mod.lastModerationActionKey).toEqual(['moderation', 'lastAction'])
  })

  it('both keys share the ["moderation"] prefix (invalidation-ready for a broad prefix match)', async () => {
    const mod = await import('../moderation')
    expect(mod.moderationQueueKey[0]).toBe('moderation')
    expect(mod.lastModerationActionKey[0]).toBe('moderation')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('fetchModerationQueue()', () => {
  it('calls supabase.rpc with name "collective_moderation_queue" and { page_size: 100 }', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { fetchModerationQueue } = await import('../moderation')
    await fetchModerationQueue()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('collective_moderation_queue', { page_size: 100 })
  })

  it('returns the rows unchanged when the RPC resolves with data', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const rows = [
      {
        post_id: 'post-1',
        author_user_id: 'author-1',
        title: 'Reported letter',
        body: 'body text',
        post_created_at: '2026-07-01T00:00:00.000Z',
        is_removed: false,
        removed_at: null,
        removed_reason: null,
        is_user_deleted: false,
        user_deleted_at: null,
        flag_count: 2,
        latest_report_reason: 'spam',
        latest_report_note: null,
        latest_report_at: '2026-07-02T00:00:00.000Z',
        reports: [
          { id: 'r1', reason_code: 'spam', note: null, created_at: '2026-07-01T01:00:00.000Z' },
          { id: 'r2', reason_code: 'spam', note: 'looks templated', created_at: '2026-07-02T00:00:00.000Z' },
        ],
      },
    ]
    rpc.mockResolvedValueOnce({ data: rows, error: null })

    const { fetchModerationQueue } = await import('../moderation')
    const result = await fetchModerationQueue()

    expect(result).toEqual(rows)
  })

  it('returns [] when the RPC resolves with data: null (defensive default)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: null, error: null })

    const { fetchModerationQueue } = await import('../moderation')
    const result = await fetchModerationQueue()

    expect(result).toEqual([])
  })

  it('throws when the RPC resolves with a PostgrestError-shaped error', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    const error = { message: 'not authorized', code: '42501', details: null, hint: null }
    rpc.mockResolvedValueOnce({ data: null, error })

    const { fetchModerationQueue } = await import('../moderation')
    await expect(fetchModerationQueue()).rejects.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useModerationQueue() useQuery config', () => {
  it('passes queryKey === moderationQueueKey', async () => {
    const { useModerationQueue, moderationQueueKey } = await import('../moderation')
    useModerationQueue()
    expect(useQueryMock).toHaveBeenCalledTimes(1)
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(moderationQueueKey)
  })

  it('declares refetchInterval === 30_000 and staleTime === 25_000 (calm cadence; staleTime < refetchInterval)', async () => {
    const { useModerationQueue } = await import('../moderation')
    useQueryMock.mockReset()
    useModerationQueue()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.refetchInterval).toBe(30_000)
    expect(opts.staleTime).toBe(25_000)
    expect(opts.staleTime).toBeLessThan(opts.refetchInterval as number)
  })

  it('declares refetchOnWindowFocus === true', async () => {
    const { useModerationQueue } = await import('../moderation')
    useQueryMock.mockReset()
    useModerationQueue()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.refetchOnWindowFocus).toBe(true)
  })

  it('wires queryFn to fetchModerationQueue (invoking it calls supabase.rpc)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const rpc = supabase.rpc as ReturnType<typeof vi.fn>
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: [], error: null })

    const { useModerationQueue } = await import('../moderation')
    useQueryMock.mockReset()
    useModerationQueue()
    const opts = useQueryMock.mock.calls[0]![0]

    await opts.queryFn()

    expect(rpc).toHaveBeenCalledWith('collective_moderation_queue', { page_size: 100 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useLastModerationActionAt() useQuery config', () => {
  it('passes queryKey === lastModerationActionKey', async () => {
    const { useLastModerationActionAt, lastModerationActionKey } = await import('../moderation')
    useQueryMock.mockReset()
    useLastModerationActionAt()
    const opts = useQueryMock.mock.calls[0]![0]
    expect(opts.queryKey).toEqual(lastModerationActionKey)
  })

  it("queryFn reads moderation_actions ordered by created_at desc, limited to 1", async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeFromChain({ data: { created_at: '2026-07-05T10:00:00.000Z' }, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementation(chain.from)

    const { useLastModerationActionAt } = await import('../moderation')
    useQueryMock.mockReset()
    useLastModerationActionAt()
    const opts = useQueryMock.mock.calls[0]![0]

    await opts.queryFn()

    expect(chain.from).toHaveBeenCalledWith('moderation_actions')
    expect(chain.select).toHaveBeenCalledWith('created_at')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('queryFn resolves to the created_at timestamp when a moderation action exists', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeFromChain({ data: { created_at: '2026-07-05T10:00:00.000Z' }, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementation(chain.from)

    const { useLastModerationActionAt } = await import('../moderation')
    useQueryMock.mockReset()
    useLastModerationActionAt()
    const opts = useQueryMock.mock.calls[0]![0]

    const result = await opts.queryFn()
    expect(result).toBe('2026-07-05T10:00:00.000Z')
  })

  it('queryFn resolves to null when no moderation action exists yet (data: null)', async () => {
    const { supabase } = await import('../../../utils/supabase')
    const chain = makeFromChain({ data: null, error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementation(chain.from)

    const { useLastModerationActionAt } = await import('../moderation')
    useQueryMock.mockReset()
    useLastModerationActionAt()
    const opts = useQueryMock.mock.calls[0]![0]

    const result = await opts.queryFn()
    expect(result).toBeNull()
  })
})
