// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/collective/BlockedUsersScreen.tsx`.
 *
 * Red-phase contract: every test MUST fail until the component is created —
 * either at import resolution or at the specific behavioral assertion once a
 * stub exists.
 *
 * Coverage:
 *   t1  — list renders one row per block, each with the 8-char anonymized id
 *         and a blocked-at date derived from created_at
 *   t2  — per-row Unblock: tap opens an inline confirm; Confirm fires
 *         useUnblockUser().mutate({ id: row.id }); Cancel fires nothing
 *   t3  — empty state: "You haven't blocked anyone."
 *   t4  — loading skeleton on cold cache; error retry state on no-cache error
 *   t5  — no activity leakage: nothing about the blocked party's posts/activity
 *         ever renders — only id-slice + blocked-at date + Unblock control
 *   t6  — renders independent of suspension state (source-level boundary: the
 *         screen never consults useIsSuspended / useMyActiveSuspension)
 *   t7  — boundary rules: no @legendapp/state import, no features/moderation
 *         import, default export (route shells default-import)
 *
 * Mock strategy: vi.mock for useBlockedUsers, useCurrentUserId; @my/ui mocked
 * to testable HTML elements. Mirrors YourPostsScreen.test.tsx patterns.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants for grep tests ────────────────────────────────────────────
const FEATURES_DIR = path.resolve(__dirname, '..')
const SCREEN_PATH = path.join(FEATURES_DIR, 'BlockedUsersScreen.tsx')

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockData: any = undefined
let mockIsLoading = false
let mockIsError = false
const mockRefetch = vi.fn()

let mockCurrentUserId: string | null | undefined = 'user-abc123'

const mutateUnblockSpy = vi.fn()
let mockUnblockIsPending = false

// ─── useBlockedUsers mock ──────────────────────────────────────────────────────
vi.mock('app/state/collective/blocks', () => ({
  useBlockedUsers: () => ({
    data: mockData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    refetch: mockRefetch,
  }),
  useUnblockUser: () => ({
    mutate: mutateUnblockSpy,
    isPending: mockUnblockIsPending,
    error: null,
  }),
}))

// ─── useCurrentUserId mock ────────────────────────────────────────────────────
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = ({ animation }: any) =>
    ReactModule.createElement('div', { 'data-dialog-overlay': 'true', 'data-animation': animation ?? '' })
  const DialogContent = ({ children, animation }: any) =>
    ReactModule.createElement(
      'div',
      { 'data-dialog-content': 'true', 'data-animation': animation ?? '' },
      children
    )
  const DialogTitle = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)
  const DialogDescription = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-dialog-desc': 'true' }, children)

  const DialogComponent = ({ children, open }: any) =>
    ReactModule.createElement(
      'div',
      { 'data-dialog': 'true', 'data-open': String(open), role: open ? 'dialog' : undefined },
      open ? children : null
    )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
  })

  return {
    AnimatePresence: ({ children }: any) => children,

    Text: ({ children, ...props }: any) =>
      ReactModule.createElement('span', {}, children),

    View: ({ children, tag, onPress, role, 'aria-label': ariaLabel, ...props }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (role) a11y['role'] = role
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (onPress) a11y['onClick'] = onPress
      return ReactModule.createElement(htmlTag, a11y, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', 'data-testid': props['data-testid'] }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),

    Separator: (_props: any) =>
      ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    ExpandingLineButton: ({ children, onPress, disabled, ...props }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'data-testid': props['data-testid'] || `btn-${String(children).toLowerCase().replace(/\s/g, '-')}`,
        },
        children
      ),

    Dialog: DialogComponent,

    useReducedMotion: () => false,
  }
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlockRow(overrides: Partial<{
  id: string
  blocker_user_id: string
  blocked_user_id: string
  created_at: string
}> = {}) {
  return {
    id: 'row-default',
    blocker_user_id: 'user-abc123',
    blocked_user_id: '9f8e7d6c-0000-0000-0000-000000000000',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

// ─── Import under test — will fail until BlockedUsersScreen.tsx exists ────────
// eslint-disable-next-line import/first
import BlockedUsersScreen from '../BlockedUsersScreen'

afterEach(() => {
  cleanup()
  mockData = undefined
  mockIsLoading = false
  mockIsError = false
  mockRefetch.mockReset()
  mockCurrentUserId = 'user-abc123'
  mutateUnblockSpy.mockReset()
  mockUnblockIsPending = false
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — list renders id-slice + blocked-at date
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — list renders anonymized ids and blocked-at dates', () => {
  it('renders one row per blocked user with the 8-char anonymized id', () => {
    mockData = [
      makeBlockRow({ id: 'row-1', blocked_user_id: '9f8e7d6c-1111-1111-1111-111111111111' }),
      makeBlockRow({ id: 'row-2', blocked_user_id: 'aabbccdd-2222-2222-2222-222222222222' }),
    ]
    render(React.createElement(BlockedUsersScreen))

    expect(screen.getByText(/9f8e7d6c/)).toBeTruthy()
    expect(screen.getByText(/aabbccdd/)).toBeTruthy()
    // The full UUID must never render.
    expect(screen.queryByText(/9f8e7d6c-1111-1111-1111-111111111111/)).toBeNull()
  })

  it('does not render more of the id than the 8-char slice anywhere in the row', () => {
    mockData = [makeBlockRow({ id: 'row-1', blocked_user_id: 'deadbeef-9999-9999-9999-999999999999' })]
    render(React.createElement(BlockedUsersScreen))
    expect(document.body.textContent).not.toContain('deadbeef-9999-9999-9999-999999999999')
  })

  it('renders a blocked-at date derived from created_at', () => {
    mockData = [
      makeBlockRow({ id: 'row-1', created_at: '2026-05-07T00:00:00.000Z' }),
    ]
    render(React.createElement(BlockedUsersScreen))
    // A human month name is the least-brittle signal that a formatted date rendered.
    const months =
      /January|February|March|April|May|June|July|August|September|October|November|December/
    expect(screen.getByText(months)).toBeTruthy()
  })

  it('renders an Unblock control per row', () => {
    mockData = [makeBlockRow({ id: 'row-1' }), makeBlockRow({ id: 'row-2' })]
    render(React.createElement(BlockedUsersScreen))
    const unblockButtons = screen.getAllByText(/unblock/i)
    expect(unblockButtons.length).toBeGreaterThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — per-row Unblock confirm flow
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — Unblock confirm flow', () => {
  it('tapping Unblock does NOT immediately fire the mutation (opens a confirm first)', () => {
    mockData = [makeBlockRow({ id: 'row-1' })]
    render(React.createElement(BlockedUsersScreen))
    fireEvent.click(screen.getByText(/unblock/i))
    expect(mutateUnblockSpy).not.toHaveBeenCalled()
  })

  it('confirming fires useUnblockUser().mutate with { id: row.id }', () => {
    mockData = [makeBlockRow({ id: 'row-target-id' })]
    render(React.createElement(BlockedUsersScreen))
    fireEvent.click(screen.getByText(/unblock/i))

    // The confirm affordance is a second "Unblock"-labeled control (the
    // locked dialog styling reuses the same Cancel/Block-style button pair).
    const confirmCandidates = screen.getAllByText(/unblock/i)
    fireEvent.click(confirmCandidates[confirmCandidates.length - 1]!)

    expect(mutateUnblockSpy).toHaveBeenCalledTimes(1)
    expect(mutateUnblockSpy).toHaveBeenCalledWith({ id: 'row-target-id' })
  })

  it('Cancel on the confirm dialog fires no mutation', () => {
    mockData = [makeBlockRow({ id: 'row-1' })]
    render(React.createElement(BlockedUsersScreen))
    fireEvent.click(screen.getByText(/unblock/i))

    const cancelBtn = screen.queryByText(/cancel/i)
    if (cancelBtn) fireEvent.click(cancelBtn)

    expect(mutateUnblockSpy).not.toHaveBeenCalled()
  })

  it('two distinct rows track independent pending-unblock state (confirming row A does not open row B\'s dialog)', () => {
    mockData = [
      makeBlockRow({ id: 'row-a', blocked_user_id: 'aaaaaaaa-0000-0000-0000-000000000000' }),
      makeBlockRow({ id: 'row-b', blocked_user_id: 'bbbbbbbb-0000-0000-0000-000000000000' }),
    ]
    render(React.createElement(BlockedUsersScreen))
    const unblockButtons = screen.getAllByText(/^unblock$/i)
    fireEvent.click(unblockButtons[0]!)

    // Only one confirm surface should be active — confirming fires exactly
    // one mutation for exactly one row id.
    const confirmCandidates = screen.getAllByText(/unblock/i)
    fireEvent.click(confirmCandidates[confirmCandidates.length - 1]!)
    expect(mutateUnblockSpy).toHaveBeenCalledTimes(1)
    expect(mutateUnblockSpy.mock.calls[0]![0]).toEqual({ id: 'row-a' })
  })

  it('the confirm surface is built on the locked Dialog primitive (Portal/Overlay/Content), not a hand-rolled absolute View', () => {
    mockData = [makeBlockRow({ id: 'row-1' })]
    render(React.createElement(BlockedUsersScreen))
    fireEvent.click(screen.getByText(/unblock/i))

    expect(document.querySelector('[data-dialog-portal]')).toBeTruthy()
    expect(document.querySelector('[data-dialog-overlay]')).toBeTruthy()
    expect(document.querySelector('[data-dialog-content]')).toBeTruthy()
  })

  it('a second row\'s Unblock affordance is disabled while an unblock mutation is in flight (no stranded confirm dialog)', () => {
    mockData = [
      makeBlockRow({ id: 'row-a' }),
      makeBlockRow({ id: 'row-b' }),
    ]
    mockUnblockIsPending = true
    render(React.createElement(BlockedUsersScreen))

    const unblockButtons = screen
      .getAllByText(/^unblock$/i)
      .map((el) => el.closest('button'))
      .filter((btn): btn is HTMLButtonElement => btn !== null)

    // Both row-level triggers are disabled while a mutation is in flight —
    // there is no way to open a second confirm dialog mid-flight, so it can
    // never be left stranded open with no feedback.
    expect(unblockButtons.length).toBeGreaterThanOrEqual(2)
    for (const btn of unblockButtons) {
      expect(btn.hasAttribute('disabled')).toBe(true)
    }

    // A click on a disabled native button fires no handler.
    fireEvent.click(unblockButtons[1]!)
    expect(mutateUnblockSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — empty state
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — empty state', () => {
  it('renders "You haven\'t blocked anyone." when the list is empty', () => {
    mockData = []
    render(React.createElement(BlockedUsersScreen))
    expect(screen.getByText(/You haven't blocked anyone\./i)).toBeTruthy()
  })

  it('does not render the empty-state copy when there are rows', () => {
    mockData = [makeBlockRow({ id: 'row-1' })]
    render(React.createElement(BlockedUsersScreen))
    expect(screen.queryByText(/You haven't blocked anyone\./i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — loading skeleton + error retry
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — loading skeleton on cold cache; error retry with no cache', () => {
  it('renders skeleton rows when isLoading is true and data is undefined', () => {
    mockIsLoading = true
    mockData = undefined
    render(React.createElement(BlockedUsersScreen))
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders a tappable retry affordance on error with no cached data', () => {
    mockIsError = true
    mockData = undefined
    mockIsLoading = false
    render(React.createElement(BlockedUsersScreen))
    expect(screen.getByText(/retry/i)).toBeTruthy()
  })

  it('tapping retry calls refetch', () => {
    mockIsError = true
    mockData = undefined
    mockIsLoading = false
    render(React.createElement(BlockedUsersScreen))
    fireEvent.click(screen.getByText(/retry/i))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('renders the skeleton — not the empty state — while the session is still resolving (currentUserId undefined)', () => {
    // useCurrentUserId() === undefined while the session is loading; the
    // query is disabled, so isLoading is false and data stays undefined.
    // Without gating on this, a user WITH blocks would see the empty-state
    // copy flash before their list ever loads.
    mockCurrentUserId = undefined
    mockIsLoading = false
    mockData = undefined
    render(React.createElement(BlockedUsersScreen))

    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBeGreaterThan(0)
    expect(screen.queryByText(/You haven't blocked anyone\./i)).toBeNull()
  })

  it('renders the empty state (not a stuck skeleton) once currentUserId resolves to null (signed out)', () => {
    mockCurrentUserId = null
    mockIsLoading = false
    mockData = undefined
    render(React.createElement(BlockedUsersScreen))

    expect(screen.getByText(/You haven't blocked anyone\./i)).toBeTruthy()
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — no activity leakage
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — no activity leakage: only id-slice + date + Unblock, nothing derived from posts', () => {
  it('never renders anything resembling post/journal content for a blocked row', () => {
    mockData = [
      makeBlockRow({ id: 'row-1', blocked_user_id: '11112222-0000-0000-0000-000000000000' }),
    ]
    render(React.createElement(BlockedUsersScreen))
    // No word-count-y or excerpt-y strings, no "posts", "wrote", "posted" language.
    expect(screen.queryByText(/post(ed|s)?\b/i)).toBeNull()
    expect(screen.queryByText(/wrote/i)).toBeNull()
    expect(screen.queryByText(/last seen/i)).toBeNull()
  })

  it('BlockedUsersScreen.tsx source does not reference posts/reactions/collective_posts (no enrichment join)', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/collective_posts/)
    expect(src).not.toMatch(/collective_reactions/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — renders independent of suspension state
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — suspension orthogonality: the screen never consults suspension state', () => {
  it('BlockedUsersScreen.tsx source does not import useIsSuspended or useMyActiveSuspension', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/useIsSuspended/)
    expect(src).not.toMatch(/useMyActiveSuspension/)
  })

  it('Unblock renders and is not disabled with no suspension hook wired at all (list + control render normally)', () => {
    mockData = [makeBlockRow({ id: 'row-1' })]
    render(React.createElement(BlockedUsersScreen))
    const unblockBtn = screen.getByText(/unblock/i).closest('button')
    expect(unblockBtn?.hasAttribute('disabled')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — boundary rules
// ─────────────────────────────────────────────────────────────────────────────

describe('t7 — boundary rules (D7 + moderation isolation + default export)', () => {
  it('BlockedUsersScreen.tsx exists on disk', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
  })

  it('does NOT import @legendapp/state', () => {
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('does NOT import from features/moderation/**', () => {
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/features\/moderation/)
  })

  it('is a default export (route shells default-import it)', () => {
    expect(typeof BlockedUsersScreen).toBe('function')
  })
})
