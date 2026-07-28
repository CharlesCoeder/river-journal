// @vitest-environment happy-dom
/**
 * ExportCollectivePosts.test.tsx — the Collective-posts data-rights export
 * entry point hosted in Privacy Center.
 *
 * Contract pinned for the green-phase implementer (renaming any of these
 * only requires updating this file's imports/mocks):
 *
 *   `packages/app/features/settings/components/ExportCollectivePosts.tsx`
 *   exports `ExportCollectivePosts` — a PROP-LESS component (mirrors
 *   `ExportJournal`'s self-contained shape). Internally:
 *     - reads `store$.session.isAuthenticated` and renders `null` when
 *       false (the export RPC is `auth.uid()`-scoped; anonymous users have
 *       no Collective posts to export) — the self-null pattern already
 *       established by `BillingSection` for tier-gating.
 *     - drives an `idle -> exporting -> done | error` state machine (no
 *       separate "options" step — there is nothing to configure).
 *     - calls `exportCollectivePosts({ fetchAllExportPosts, onProgress })`
 *       from `app/utils/exportCollectivePosts`, passing the REAL
 *       `fetchAllExportPosts` imported from `app/state/collective/exportPosts`
 *       (not a locally re-implemented fetcher).
 *     - NEVER calls `downloadExport` itself — delivery happens inside the
 *       orchestrator.
 *
 *   Test ids (this file's asserted contract):
 *     - idle:      `export-collective-open` (pressable; starts the export
 *                  immediately on press — no intermediate options screen)
 *     - exporting: `export-collective-progress`, text
 *                  `Exporting your Collective posts… {count} so far`
 *     - done:      `export-collective-done-reset`, text
 *                  `Exported {totalPosts} {post|posts} and {totalReplies}
 *                  {reply|replies}.`
 *     - error:     `export-collective-retry` (a Retry affordance); calm
 *                  copy, no lockout.
 *
 * Collaborators mocked at the module boundary (independently covered
 * elsewhere): `app/utils/exportCollectivePosts`'s `exportCollectivePosts`
 * (the pure formatter + fetch/format/deliver orchestration is covered by its
 * own unit tests) and `app/state/collective/exportPosts`'s
 * `fetchAllExportPosts` (the pagination loop is covered by its own unit
 * tests). `app/utils/downloadExport` is spied on ONLY to assert this
 * component never calls it directly.
 *
 * Red-phase: `packages/app/features/settings/components/ExportCollectivePosts.tsx`
 * does not exist yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── Deferred-promise helper for driving the in-flight "exporting" state ───
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ─── app/utils/exportCollectivePosts — the orchestrator, mocked ────────────
const exportCollectivePostsMock = vi.fn()
vi.mock('app/utils/exportCollectivePosts', () => ({
  exportCollectivePosts: (args: unknown) => exportCollectivePostsMock(args),
}))

// ─── app/state/collective/exportPosts — the REAL fetcher reference, mocked
// only so no supabase import is ever reached; the component must pass THIS
// exact reference through to the orchestrator, not a locally-defined one.
// Hoisted via `vi.hoisted` (the `invokeMock` precedent in subscriptionApi.test)
// because the factory exposes the raw fn reference eagerly — the mocked module
// is imported at load time, so the fn must exist before the hoisted factory runs.
const { fetchAllExportPostsMock } = vi.hoisted(() => ({ fetchAllExportPostsMock: vi.fn() }))
vi.mock('app/state/collective/exportPosts', () => ({
  fetchAllExportPosts: fetchAllExportPostsMock,
}))

// ─── app/utils/downloadExport — spied on only to assert it is NEVER called
// directly by this component (the orchestrator owns delivery).
const downloadExportMock = vi.fn().mockResolvedValue(undefined)
vi.mock('app/utils/downloadExport', () => ({
  downloadExport: (...args: unknown[]) => downloadExportMock(...args),
}))

// ─── app/state/store — getter-observable pattern (HomeScreen.collective-gate
// precedent): `use$`/@legendapp/state/react is left UNMOCKED so the real hook
// reacts to `.set()` calls made from the test body. The observable must come
// from the SAME @legendapp/state module instance app code uses, built here
// via `vi.importActual` inside the async factory.
vi.mock('app/state/store', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const isAuthenticated$ = observable(false)
  return {
    store$: {
      session: {
        isAuthenticated: isAuthenticated$,
      },
    },
  }
})

// ─── @my/ui — minimal passthrough preserving testID/onPress ───────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, ...rest } = props as Record<string, unknown> & {
      testID?: string
      onPress?: () => void
    }
    const out: Record<string, unknown> = { ...rest }
    if (testID) out['data-testid'] = testID
    if (onPress) out.onClick = onPress
    return out
  }

  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      ReactModule.createElement(tag, mapProps(props), children)

  return {
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

// ─── Import under test (real component) ─────────────────────────────────────
import { ExportCollectivePosts } from '../ExportCollectivePosts'
import { store$ } from 'app/state/store'

const isAuthenticated$ = store$.session.isAuthenticated

function openExport() {
  fireEvent.click(screen.getByTestId('export-collective-open'))
}

beforeEach(() => {
  exportCollectivePostsMock.mockReset()
  fetchAllExportPostsMock.mockReset()
  downloadExportMock.mockReset().mockResolvedValue(undefined)
  act(() => {
    isAuthenticated$.set(true)
  })
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated-only visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('authenticated-only visibility', () => {
  it('renders nothing for an unauthenticated (anonymous) session', () => {
    act(() => isAuthenticated$.set(false))
    render(React.createElement(ExportCollectivePosts))
    expect(screen.queryByTestId('export-collective-open')).toBeNull()
  })

  it('renders the entry affordance for an authenticated session', () => {
    act(() => isAuthenticated$.set(true))
    render(React.createElement(ExportCollectivePosts))
    expect(screen.getByTestId('export-collective-open')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wiring: real fetcher + running-count progress callback
// ─────────────────────────────────────────────────────────────────────────────

describe('wires exportCollectivePosts with the real fetcher + a progress callback', () => {
  it('calls exportCollectivePosts with { fetchAllExportPosts, onProgress } — fetchAllExportPosts is the real imported reference', async () => {
    const { promise } = deferred<{ totalPosts: number; totalReplies: number }>()
    exportCollectivePostsMock.mockReturnValue(promise)

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(exportCollectivePostsMock).toHaveBeenCalledTimes(1))
    const [args] = exportCollectivePostsMock.mock.calls[0] as [
      { fetchAllExportPosts: unknown; onProgress: (count: number) => void },
    ]
    expect(args.fetchAllExportPosts).toBe(fetchAllExportPostsMock)
    expect(typeof args.onProgress).toBe('function')
  })

  it('never calls downloadExport directly — delivery happens inside the orchestrator', async () => {
    exportCollectivePostsMock.mockResolvedValue({ totalPosts: 2, totalReplies: 1 })

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(screen.getByTestId('export-collective-done-reset')).toBeTruthy())
    expect(downloadExportMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Running-count progress — calm text, no spinner
// ─────────────────────────────────────────────────────────────────────────────

describe('running-count progress text, no spinner', () => {
  it('renders "Exporting your Collective posts… {count} so far" and updates as onProgress ticks', async () => {
    const { promise } = deferred<{ totalPosts: number; totalReplies: number }>()
    let capturedOnProgress: ((count: number) => void) | undefined
    exportCollectivePostsMock.mockImplementation(
      (args: { onProgress?: (count: number) => void }) => {
        capturedOnProgress = args.onProgress
        return promise
      }
    )

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(capturedOnProgress).toBeTruthy())

    act(() => capturedOnProgress?.(49))
    await waitFor(() => {
      expect(screen.getByTestId('export-collective-progress').textContent).toBe(
        'Exporting your Collective posts… 49 so far'
      )
    })

    act(() => capturedOnProgress?.(98))
    await waitFor(() => {
      expect(screen.getByTestId('export-collective-progress').textContent).toBe(
        'Exporting your Collective posts… 98 so far'
      )
    })
  })

  it('renders "0 so far" (or no count yet ticked) before the first onProgress call, never a spinner', async () => {
    const { promise } = deferred<{ totalPosts: number; totalReplies: number }>()
    exportCollectivePostsMock.mockReturnValue(promise)

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(screen.getByTestId('export-collective-progress')).toBeTruthy())
    expect(screen.getByTestId('export-collective-progress').textContent).toContain('0 so far')
  })

  it('never renders a spinner/activity-indicator across the exporting → done lifecycle', async () => {
    exportCollectivePostsMock.mockResolvedValue({ totalPosts: 3, totalReplies: 0 })

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(screen.getByTestId('export-collective-done-reset')).toBeTruthy())

    expect(document.querySelector('[role="progressbar"]')).toBeNull()
    expect(document.querySelector('[data-testid*="spinner" i]')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Success — post/reply counts from the returned totals
// ─────────────────────────────────────────────────────────────────────────────

describe('success — shows post/reply counts from the orchestrator result', () => {
  it('shows the exact totalPosts/totalReplies from the resolved result', async () => {
    exportCollectivePostsMock.mockResolvedValue({ totalPosts: 12, totalReplies: 5 })

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => {
      expect(screen.getByText('Exported 12 posts and 5 replies.')).toBeTruthy()
    })
  })

  it('uses singular "post"/"reply" wording for a count of exactly 1', async () => {
    exportCollectivePostsMock.mockResolvedValue({ totalPosts: 1, totalReplies: 1 })

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => {
      expect(screen.getByText('Exported 1 post and 1 reply.')).toBeTruthy()
    })
  })

  it('handles the empty-history case (0 posts, 0 replies) without special-casing UI — the orchestrator already delivered the calm empty-state file', async () => {
    exportCollectivePostsMock.mockResolvedValue({ totalPosts: 0, totalReplies: 0 })

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => {
      expect(screen.getByText('Exported 0 posts and 0 replies.')).toBeTruthy()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — calm copy + Retry, retry re-runs pagination from zero
// ─────────────────────────────────────────────────────────────────────────────

describe('error handling — calm copy + Retry', () => {
  it('shows a calm error state and a Retry affordance on rejection (the orchestrator rethrows)', async () => {
    exportCollectivePostsMock.mockRejectedValueOnce(new Error('network blip'))

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())
  })

  it('never renders a spinner in the error state', async () => {
    exportCollectivePostsMock.mockRejectedValueOnce(new Error('network blip'))

    render(React.createElement(ExportCollectivePosts))
    openExport()

    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('Retry re-invokes the orchestrator a second time', async () => {
    exportCollectivePostsMock.mockRejectedValueOnce(new Error('network blip'))

    render(React.createElement(ExportCollectivePosts))
    openExport()
    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())

    exportCollectivePostsMock.mockResolvedValueOnce({ totalPosts: 4, totalReplies: 2 })
    fireEvent.click(screen.getByTestId('export-collective-retry'))

    await waitFor(() => expect(exportCollectivePostsMock).toHaveBeenCalledTimes(2))
  })

  it("Retry re-runs pagination from page 1 — the running count RESETS to 0, it does not resume from the failed attempt's count", async () => {
    // First attempt: progress ticks up to 40, then the orchestrator rejects
    // (e.g. the connection dropped on a later page).
    let firstOnProgress: ((count: number) => void) | undefined
    const { promise: firstPromise, reject: rejectFirst } = deferred<never>()
    exportCollectivePostsMock.mockImplementationOnce(
      (args: { onProgress?: (count: number) => void }) => {
        firstOnProgress = args.onProgress
        return firstPromise
      }
    )

    render(React.createElement(ExportCollectivePosts))
    openExport()
    await waitFor(() => expect(firstOnProgress).toBeTruthy())
    act(() => firstOnProgress?.(40))
    await waitFor(() => {
      expect(screen.getByTestId('export-collective-progress').textContent).toContain('40 so far')
    })

    await act(async () => {
      rejectFirst(new Error('connection dropped'))
      await firstPromise.catch(() => {})
    })
    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())

    // Retry: a fresh attempt whose FIRST tick is a small number (page 1's
    // worth of rows) — proving the count did not carry over the prior 40.
    let secondOnProgress: ((count: number) => void) | undefined
    const { promise: secondPromise } = deferred<{ totalPosts: number; totalReplies: number }>()
    exportCollectivePostsMock.mockImplementationOnce(
      (args: { onProgress?: (count: number) => void }) => {
        secondOnProgress = args.onProgress
        return secondPromise
      }
    )
    fireEvent.click(screen.getByTestId('export-collective-retry'))

    await waitFor(() => expect(secondOnProgress).toBeTruthy())
    act(() => secondOnProgress?.(5))

    await waitFor(() => {
      const text = screen.getByTestId('export-collective-progress').textContent ?? ''
      expect(text).toContain('5 so far')
      expect(text).not.toContain('45')
      expect(text).not.toContain('40')
    })
  })

  it('no lockout — Retry stays available after repeated failures', async () => {
    exportCollectivePostsMock.mockRejectedValueOnce(new Error('fail 1'))

    render(React.createElement(ExportCollectivePosts))
    openExport()
    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())

    exportCollectivePostsMock.mockRejectedValueOnce(new Error('fail 2'))
    fireEvent.click(screen.getByTestId('export-collective-retry'))

    await waitFor(() => expect(exportCollectivePostsMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('export-collective-retry')).toBeTruthy())
  })
})
