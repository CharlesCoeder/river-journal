// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `state/collective/moderationMutations.ts`.
 *
 * Red-phase contract: every test in this file MUST fail until the target
 * module is created — the whole file fails at the top-level
 * `import 'app/state/collective/moderationMutations'` with a module-resolution
 * error, per this repo's established red-phase convention (see
 * `state/collective/__tests__/mutations.test.ts`).
 *
 * Contract this file locks in for the implementation, mirroring the canonical
 * pattern in `state/collective/mutations.ts`:
 *   - `queryClient.setMutationDefaults` runs at module load (a bare import
 *     is enough to register defaults) for three mutation keys:
 *     ['moderation','remove'], ['moderation','suspend'], ['moderation','note'].
 *   - Each registered `mutationFn` calls the matching Supabase RPC with the
 *     exact named-arg shape the DEFINER functions expect.
 *   - Every registered default's settle path invalidates the ['moderation']
 *     query-key prefix on success.
 *   - The remove mutation applies a row-scoped optimistic patch (never a
 *     whole-array clobber) and rolls back only what it touched, tolerating a
 *     target row that isn't present in the cache (offline-replay safety).
 *   - `useRemovePost` / `useSuspendUser` / `useAddModerationNote` are thin
 *     `useMutation({ mutationKey })` hooks with NO inline `mutationFn` — the
 *     registered default is the executable path on persisted replay.
 *   - The suspend mutationFn forwards whatever `reason` string it is given
 *     straight to the RPC (no re-composition at this layer — composing a
 *     templated code with an optional custom note into one string is a
 *     caller/dialog concern, this layer is a pass-through).
 *   - No note/reason free text ever reaches a console/telemetry call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

// ─── Path constant for source-grep tests ──────────────────────────────────────
const MODULE_PATH = path.resolve(__dirname, '..', 'moderationMutations.ts')

// ─── Supabase mock — hoisted before SUT import ────────────────────────────────
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

// ─── SUT imports — importing the module triggers setMutationDefaults at
// module load, registering the three defaults on the shared queryClient
// singleton before any test runs. ─────────────────────────────────────────────
import 'app/state/collective/moderationMutations'
import {
  useRemovePost,
  useSuspendUser,
  useAddModerationNote,
} from 'app/state/collective/moderationMutations'
import { queryClient } from 'app/state/queryClient'
import { moderationQueueKey, type ModerationQueueItem } from 'app/state/collective/moderation'

// TanStack Query v5.100: mutation lifecycle callbacks take a trailing
// MutationFunctionContext. Tests invoke the registered defaults directly, so
// supply a minimal context — the registered implementations ignore it.
const MUTATION_FN_CONTEXT = { client: queryClient, meta: undefined }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
}

function makeQueueRow(overrides: Partial<ModerationQueueItem> = {}): ModerationQueueItem {
  return {
    post_id: 'post-1',
    author_user_id: 'author-1',
    title: 'A reported letter',
    body: 'The reported body text.',
    post_created_at: '2026-07-01T00:00:00.000Z',
    is_removed: false,
    removed_at: null,
    removed_reason: null,
    is_user_deleted: false,
    user_deleted_at: null,
    flag_count: 1,
    latest_report_reason: 'spam',
    latest_report_note: null,
    latest_report_at: '2026-07-01T00:00:00.000Z',
    reports: [
      { id: 'r1', reason_code: 'spam', note: null, created_at: '2026-07-01T00:00:00.000Z' },
    ],
    ...overrides,
  } as ModerationQueueItem
}

beforeEach(() => {
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: null, error: null })
  // setQueryData(key, undefined) is a no-op in TanStack Query v5 (an undefined
  // value bails out), so removeQueries is the only way to truly reset the shared
  // singleton's cache between tests.
  queryClient.removeQueries({ queryKey: moderationQueueKey })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Module-load registration
// ═══════════════════════════════════════════════════════════════════════════════

describe('module-load setMutationDefaults registration', () => {
  it('registers a default for ["moderation","remove"] on import', () => {
    expect(queryClient.getMutationDefaults(['moderation', 'remove'])).toBeDefined()
  })

  it('registers a default for ["moderation","suspend"] on import', () => {
    expect(queryClient.getMutationDefaults(['moderation', 'suspend'])).toBeDefined()
  })

  it('registers a default for ["moderation","note"] on import', () => {
    expect(queryClient.getMutationDefaults(['moderation', 'note'])).toBeDefined()
  })

  it('does NOT register a default for ["moderation","reinstate"] (not wired to UI)', () => {
    // TanStack Query v5's getMutationDefaults returns a merged {} for an
    // unmatched key (never undefined), so the meaningful "not wired" assertion
    // is the absence of a registered mutationFn.
    expect(queryClient.getMutationDefaults(['moderation', 'reinstate'])?.mutationFn).toBeUndefined()
  })

  it('each registered default has a mutationFn, onError, and an onSettled or onSuccess', () => {
    for (const key of [
      ['moderation', 'remove'],
      ['moderation', 'suspend'],
      ['moderation', 'note'],
    ] as const) {
      const defaults = queryClient.getMutationDefaults([...key])
      expect(defaults?.mutationFn, `${key.join('.')} mutationFn`).toBeDefined()
      expect(
        defaults?.onSettled ?? defaults?.onSuccess,
        `${key.join('.')} onSettled/onSuccess`
      ).toBeDefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// remove_post mutationFn
// ═══════════════════════════════════════════════════════════════════════════════

describe('["moderation","remove"] mutationFn', () => {
  it('calls supabase.rpc("remove_post", ...) with exact named args when a custom note is present', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    await (defaults!.mutationFn as any)({
      target_post_id: 'post-9',
      reason_code: 'harassment',
      custom_note: 'a note',
    })

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('remove_post', {
      target_post_id: 'post-9',
      reason_code: 'harassment',
      custom_note: 'a note',
    })
  })

  it('defaults custom_note to null when omitted', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    await (defaults!.mutationFn as any)({ target_post_id: 'post-10', reason_code: 'spam' })

    expect(rpcMock).toHaveBeenCalledWith('remove_post', {
      target_post_id: 'post-10',
      reason_code: 'spam',
      custom_note: null,
    })
  })

  it('throws when the RPC resolves with an error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid input', code: '22023' },
    })
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])

    await expect(
      (defaults!.mutationFn as any)({ target_post_id: 'post-11', reason_code: 'spam' })
    ).rejects.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// suspend_user mutationFn
// ═══════════════════════════════════════════════════════════════════════════════

describe('["moderation","suspend"] mutationFn', () => {
  it('calls supabase.rpc("suspend_user", ...) with kind fixed to "post_react"', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    await (defaults!.mutationFn as any)({
      target_user_id: 'user-5',
      duration_days: 7,
      reason: 'harassment',
    })

    expect(rpcMock).toHaveBeenCalledWith('suspend_user', {
      target_user_id: 'user-5',
      kind: 'post_react',
      duration_days: 7,
      reason: 'harassment',
    })
  })

  it('defaults reason to null when omitted', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    await (defaults!.mutationFn as any)({ target_user_id: 'user-6', duration_days: 1 })

    expect(rpcMock).toHaveBeenCalledWith('suspend_user', {
      target_user_id: 'user-6',
      kind: 'post_react',
      duration_days: 1,
      reason: null,
    })
  })

  it('forwards a caller-composed "code: note" reason string verbatim (no re-mapping at this layer)', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    await (defaults!.mutationFn as any)({
      target_user_id: 'user-7',
      duration_days: 30,
      reason: 'harassment: repeated targeted messages',
    })

    const call = rpcMock.mock.calls[0]!
    expect(call[1].reason).toBe('harassment: repeated targeted messages')
  })

  it('never accepts a "kind" var from the caller — kind is fixed inside the mutationFn', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    // Passing an unexpected kind field must not leak through to the RPC call.
    await (defaults!.mutationFn as any)({
      target_user_id: 'user-8',
      duration_days: 1,
      reason: null,
      kind: 'something_else',
    } as any)

    const call = rpcMock.mock.calls[0]!
    expect(call[1].kind).toBe('post_react')
  })

  it('throws when the RPC resolves with an error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'not authorized', code: '42501' },
    })
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])

    await expect(
      (defaults!.mutationFn as any)({ target_user_id: 'user-9', duration_days: 1 })
    ).rejects.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// add_moderation_note mutationFn
// ═══════════════════════════════════════════════════════════════════════════════

describe('["moderation","note"] mutationFn', () => {
  it('calls supabase.rpc("add_moderation_note", ...) with note + target_post_id', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'note'])
    await (defaults!.mutationFn as any)({ note: 'borderline case', target_post_id: 'post-20' })

    expect(rpcMock).toHaveBeenCalledWith('add_moderation_note', {
      note: 'borderline case',
      target_post_id: 'post-20',
    })
  })

  it('throws when the RPC resolves with an error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid input', code: '22023' },
    })
    const defaults = queryClient.getMutationDefaults(['moderation', 'note'])

    await expect(
      (defaults!.mutationFn as any)({ note: 'x', target_post_id: 'post-21' })
    ).rejects.toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// onSettled / onSuccess — ['moderation'] prefix invalidation
// ═══════════════════════════════════════════════════════════════════════════════

describe('settle-path invalidation reaches the ["moderation"] prefix', () => {
  it.each([
    ['remove', ['moderation', 'remove']],
    ['suspend', ['moderation', 'suspend']],
    ['note', ['moderation', 'note']],
  ] as const)('%s: settle path invalidates queryKey: ["moderation"]', async (_label, key) => {
    const defaults = queryClient.getMutationDefaults([...key])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const settle = defaults!.onSettled ?? defaults!.onSuccess
    await (settle as any)(undefined, null, {}, undefined, MUTATION_FN_CONTEXT)

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['moderation'] })
    )
    invalidateSpy.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Optimistic remove — row-scoped patch + rollback
// ═══════════════════════════════════════════════════════════════════════════════

describe('["moderation","remove"] onMutate — row-scoped optimistic patch', () => {
  it('cancels in-flight ["moderation"] queries before patching', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')

    await (defaults!.onMutate as any)(
      { target_post_id: 'post-1', reason_code: 'spam' },
      MUTATION_FN_CONTEXT
    )

    expect(cancelSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['moderation'] }))
  })

  it('sets only the matching row is_removed: true, leaving sibling rows untouched', async () => {
    const rowA = makeQueueRow({ post_id: 'post-a', is_removed: false })
    const rowB = makeQueueRow({ post_id: 'post-b', is_removed: false })
    queryClient.setQueryData(moderationQueueKey, [rowA, rowB])

    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    await (defaults!.onMutate as any)(
      { target_post_id: 'post-a', reason_code: 'spam' },
      MUTATION_FN_CONTEXT
    )

    const after = queryClient.getQueryData<ModerationQueueItem[]>(moderationQueueKey)
    const patched = after!.find((r) => r.post_id === 'post-a')
    const sibling = after!.find((r) => r.post_id === 'post-b')
    expect(patched!.is_removed).toBe(true)
    expect(sibling!.is_removed).toBe(false)
  })

  it('returns the pre-patch snapshot in context', async () => {
    const rowA = makeQueueRow({ post_id: 'post-c', is_removed: false })
    queryClient.setQueryData(moderationQueueKey, [rowA])

    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    const context = await (defaults!.onMutate as any)(
      { target_post_id: 'post-c', reason_code: 'spam' },
      MUTATION_FN_CONTEXT
    )

    const snapshot = (context as { snapshot?: ModerationQueueItem[] }).snapshot
    expect(snapshot).toBeDefined()
    expect(snapshot!.find((r) => r.post_id === 'post-c')!.is_removed).toBe(false)
  })

  it('tolerates an absent target row (offline-replay safety) without throwing', async () => {
    const rowA = makeQueueRow({ post_id: 'post-present', is_removed: false })
    queryClient.setQueryData(moderationQueueKey, [rowA])

    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])

    await expect(
      (defaults!.onMutate as any)(
        { target_post_id: 'post-not-in-cache', reason_code: 'spam' },
        MUTATION_FN_CONTEXT
      )
    ).resolves.toBeDefined()

    // The untouched row must remain exactly as it was.
    const after = queryClient.getQueryData<ModerationQueueItem[]>(moderationQueueKey)
    expect(after!.find((r) => r.post_id === 'post-present')!.is_removed).toBe(false)
  })

  it('is a no-op (no throw, undefined-safe) when the queue cache is empty/undefined', async () => {
    queryClient.setQueryData(moderationQueueKey, undefined)
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])

    await expect(
      (defaults!.onMutate as any)(
        { target_post_id: 'post-x', reason_code: 'spam' },
        MUTATION_FN_CONTEXT
      )
    ).resolves.toBeDefined()
  })
})

describe('["moderation","remove"] onError — row-scoped rollback', () => {
  it('restores the snapshot when defined', async () => {
    const rowA = makeQueueRow({ post_id: 'post-d', is_removed: false })
    queryClient.setQueryData(moderationQueueKey, [rowA])

    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    const context = await (defaults!.onMutate as any)(
      { target_post_id: 'post-d', reason_code: 'spam' },
      MUTATION_FN_CONTEXT
    )

    // Optimistic patch applied.
    expect(
      queryClient
        .getQueryData<ModerationQueueItem[]>(moderationQueueKey)!
        .find((r) => r.post_id === 'post-d')!.is_removed
    ).toBe(true)

    await (defaults!.onError as any)(
      new Error('failed'),
      { target_post_id: 'post-d', reason_code: 'spam' },
      context,
      MUTATION_FN_CONTEXT
    )

    expect(
      queryClient
        .getQueryData<ModerationQueueItem[]>(moderationQueueKey)!
        .find((r) => r.post_id === 'post-d')!.is_removed
    ).toBe(false)
  })

  it('rolls back ONLY the target row, preserving a concurrent optimistic patch on a sibling', async () => {
    const rowA = makeQueueRow({ post_id: 'post-a', is_removed: false })
    const rowB = makeQueueRow({ post_id: 'post-b', is_removed: false })
    queryClient.setQueryData(moderationQueueKey, [rowA, rowB])

    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    const context = await (defaults!.onMutate as any)(
      { target_post_id: 'post-a', reason_code: 'spam' },
      MUTATION_FN_CONTEXT
    )

    // Simulate a concurrent in-flight mutation optimistically patching sibling B
    // AFTER A's pre-patch snapshot was captured.
    queryClient.setQueryData<ModerationQueueItem[]>(moderationQueueKey, (prev) =>
      (prev ?? []).map((r) => (r.post_id === 'post-b' ? { ...r, is_removed: true } : r))
    )

    await (defaults!.onError as any)(
      new Error('failed'),
      { target_post_id: 'post-a', reason_code: 'spam' },
      context,
      MUTATION_FN_CONTEXT
    )

    const after = queryClient.getQueryData<ModerationQueueItem[]>(moderationQueueKey)!
    // A is rolled back to its pre-patch state...
    expect(after.find((r) => r.post_id === 'post-a')!.is_removed).toBe(false)
    // ...but B's concurrent patch survives (a whole-array restore would clobber it).
    expect(after.find((r) => r.post_id === 'post-b')!.is_removed).toBe(true)
  })

  it('never calls setQueryData(key, undefined) when the snapshot is undefined', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')

    await (defaults!.onError as any)(
      new Error('failed'),
      { target_post_id: 'post-e', reason_code: 'spam' },
      { snapshot: undefined },
      MUTATION_FN_CONTEXT
    )

    const undefinedCalls = setQueryDataSpy.mock.calls.filter((call) => call[1] === undefined)
    expect(undefinedCalls.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// suspend / note onMutate — must never throw (no required cache mutation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('["moderation","suspend"] and ["moderation","note"] onMutate do not crash', () => {
  it('suspend onMutate resolves to null (no cache mutation) on an empty cache', async () => {
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    await expect(
      (defaults!.onMutate as any)?.(
        { target_user_id: 'user-1', duration_days: 1, reason: null },
        MUTATION_FN_CONTEXT
      ) ?? Promise.resolve(null)
    ).resolves.toBeNull()
  })

  it('note onMutate resolves without throwing and applies no cache change', async () => {
    queryClient.setQueryData(moderationQueueKey, undefined)
    const defaults = queryClient.getMutationDefaults(['moderation', 'note'])
    await (defaults!.onMutate as any)?.(
      { note: 'x', target_post_id: 'post-1' },
      MUTATION_FN_CONTEXT
    )
    expect(queryClient.getQueryData(moderationQueueKey)).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Hook exports — thin useMutation({ mutationKey }) wrappers, no inline mutationFn
// ═══════════════════════════════════════════════════════════════════════════════

describe('hook exports', () => {
  it('useRemovePost is an exported function returning mutate/isPending', () => {
    expect(typeof useRemovePost).toBe('function')
    const localQc = new QueryClient()
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    if (defaults) localQc.setMutationDefaults(['moderation', 'remove'], defaults)

    const { result } = renderHook(() => useRemovePost(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
  })

  it('useSuspendUser is an exported function returning mutate/isPending', () => {
    expect(typeof useSuspendUser).toBe('function')
    const localQc = new QueryClient()
    const defaults = queryClient.getMutationDefaults(['moderation', 'suspend'])
    if (defaults) localQc.setMutationDefaults(['moderation', 'suspend'], defaults)

    const { result } = renderHook(() => useSuspendUser(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
  })

  it('useAddModerationNote is an exported function returning mutate/isPending', () => {
    expect(typeof useAddModerationNote).toBe('function')
    const localQc = new QueryClient()
    const defaults = queryClient.getMutationDefaults(['moderation', 'note'])
    if (defaults) localQc.setMutationDefaults(['moderation', 'note'], defaults)

    const { result } = renderHook(() => useAddModerationNote(), { wrapper: makeWrapper(localQc) })
    expect(typeof result.current.mutate).toBe('function')
    expect(typeof result.current.isPending).toBe('boolean')
  })

  it('calling useRemovePost().mutate(...) reaches supabase.rpc("remove_post", ...) end to end', async () => {
    const localQc = new QueryClient()
    const defaults = queryClient.getMutationDefaults(['moderation', 'remove'])
    if (defaults) localQc.setMutationDefaults(['moderation', 'remove'], defaults)

    const { result } = renderHook(() => useRemovePost(), { wrapper: makeWrapper(localQc) })
    result.current.mutate({ target_post_id: 'post-hook', reason_code: 'spam' })

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        'remove_post',
        expect.objectContaining({ target_post_id: 'post-hook' })
      )
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Source-grep guardrails — D7 boundary + privacy
// ═══════════════════════════════════════════════════════════════════════════════

describe('source-grep guardrails', () => {
  it('moderationMutations.ts exists on disk', () => {
    expect(existsSync(MODULE_PATH)).toBe(true)
  })

  it('does NOT import @legendapp/state (D7 boundary rule)', () => {
    expect(existsSync(MODULE_PATH)).toBe(true)
    const src = readFileSync(MODULE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('the consumer hooks do not declare an inline mutationFn (persisted-replay footgun)', () => {
    expect(existsSync(MODULE_PATH)).toBe(true)
    const src = readFileSync(MODULE_PATH, 'utf8')
    const hookBodies = src.match(/export function use\w+\([^)]*\)[^{]*\{[\s\S]*?\n\}/g) ?? []
    expect(hookBodies.length).toBeGreaterThan(0)
    for (const body of hookBodies) {
      expect(body).not.toMatch(/mutationFn\s*:/)
    }
  })

  it('does NOT contain a console.* call with "note" or "reason" in the same expression', () => {
    expect(existsSync(MODULE_PATH)).toBe(true)
    const src = readFileSync(MODULE_PATH, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*(note|reason)/i)
  })
})
