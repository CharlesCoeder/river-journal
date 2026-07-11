// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/collective/BlockUserConfirmDialog.tsx`.
 *
 * Red-phase contract: every test MUST fail until the component is created —
 * either at import resolution or at the specific behavioral assertion once a
 * stub exists.
 *
 * Coverage:
 *   t1 — controlled dialog: renders only when open===true; no internal
 *        open-state (parent-driven via onOpenChange)
 *   t2 — copy: title/body reads the anonymized 8-char slice of blockedUserId
 *   t3 — Confirm fires useBlockUser().mutate with the exact vars, exactly
 *        once, and closes the dialog IMMEDIATELY (never awaits the mutation)
 *   t4 — Confirm is a no-op while isPending===true (double-tap guard)
 *   t5 — Cancel fires no mutation and closes the dialog
 *   t6 — defensive bail: blockerUserId === blockedUserId → no mutate, dialog
 *        still closes
 *   t7 — defensive bail: nullish blockedUserId → no mutate, dialog still
 *        closes
 *   t8 — silent-invariant copy sweep: no "they won't know" / blocked-vs-
 *        removed asymmetry; copy is identical regardless of any other prop
 *
 * Mock strategy: vi.mock for useBlockUser; @my/ui mocked to testable HTML
 * elements mirroring FlagAffordance.test.tsx's Dialog mock shape.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Hoisted spy refs ──────────────────────────────────────────────────────────
const { mutateSpy } = vi.hoisted(() => ({ mutateSpy: vi.fn() }))

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockIsPending = false
let reduceMotionValue = false

vi.mock('app/state/collective/blocks', () => ({
  useBlockUser: () => ({
    mutate: mutateSpy,
    isPending: mockIsPending,
    error: null,
  }),
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
    Text: ({ children }: any) => ReactModule.createElement('span', {}, children),
    XStack: ({ children }: any) => ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) => ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    Dialog: DialogComponent,
    ExpandingLineButton: ({ children, onPress, disabled }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => reduceMotionValue,
  }
})

// ─── Import under test ─────────────────────────────────────────────────────────
import { BlockUserConfirmDialog } from '../BlockUserConfirmDialog'

afterEach(() => {
  cleanup()
  mutateSpy.mockReset()
  mockIsPending = false
  reduceMotionValue = false
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — controlled dialog
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — controlled dialog (open/onOpenChange props, not internal state)', () => {
  it('renders nothing observable when open===false', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: false,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-uuid-1',
        blockedUserId: 'blocked-uuid-1',
      })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the dialog content when open===true', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-uuid-1',
        blockedUserId: 'blocked-uuid-1',
      })
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — copy: anonymized 8-char slice
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — copy uses the 8-char anonymized slice of blockedUserId', () => {
  it('title/body includes blockedUserId.slice(0, 8)', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-uuid-1',
        blockedUserId: '12345678-abcd-ef00-0000-000000000000',
      })
    )
    expect(screen.getByText(/12345678/)).toBeTruthy()
    // The full UUID must never render — only the 8-char slice (surface-wide convention).
    expect(screen.queryByText(/12345678-abcd-ef00-0000-000000000000/)).toBeNull()
  })

  it('copy communicates the mutual/silent nature: "won\'t see their posts" and "won\'t see yours"', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-uuid-1',
        blockedUserId: 'abcdefgh-0000-0000-0000-000000000000',
      })
    )
    expect(screen.getByText(/won.t see their posts/i)).toBeTruthy()
    expect(screen.getByText(/won.t see yours/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — Confirm fires mutate once + closes immediately (no await)
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — Confirm fires mutate exactly once with correct vars, closes immediately', () => {
  it('mutate is called once with { blocker_user_id, blocked_user_id }', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy).toHaveBeenCalledWith({
      blocker_user_id: 'blocker-a',
      blocked_user_id: 'blocked-b',
    })
  })

  it('onOpenChange(false) is called synchronously in the same tick as mutate — never awaits the mutation', () => {
    const onOpenChange = vi.fn()
    // mutate never resolves during the test — proves the close does not wait on it.
    mutateSpy.mockImplementation(() => new Promise(() => {}))

    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange,
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — isPending guard
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — Confirm is a no-op while isPending===true', () => {
  it('mutate is NOT called when Confirm is tapped during isPending', () => {
    mockIsPending = true
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))

    expect(mutateSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — Cancel
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — Cancel fires no mutation and closes', () => {
  it('mutate NOT called on Cancel', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('onOpenChange(false) called on Cancel', () => {
    const onOpenChange = vi.fn()
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange,
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6/t7 — defensive self-block / nullish bail
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — defensive bail: blockerUserId === blockedUserId', () => {
  it('Confirm fires NO mutate when blockerUserId equals blockedUserId', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'same-user',
        blockedUserId: 'same-user',
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))
    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('still closes the dialog on the self-block bail path', () => {
    const onOpenChange = vi.fn()
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange,
        blockerUserId: 'same-user',
        blockedUserId: 'same-user',
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('t7 — defensive bail: nullish blockedUserId', () => {
  it('Confirm fires NO mutate when blockedUserId is null', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: null,
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))
    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('still closes the dialog when blockedUserId is null', () => {
    const onOpenChange = vi.fn()
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange,
        blockerUserId: 'blocker-a',
        blockedUserId: null,
      })
    )
    fireEvent.click(screen.getByTestId('btn-block'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — silent-invariant copy sweep
// ─────────────────────────────────────────────────────────────────────────────

describe('t8 — silent-invariant copy sweep', () => {
  it('does not leak any "they will know" / notification-style phrasing', () => {
    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: 'blocked-b',
      })
    )
    expect(screen.queryByText(/notify/i)).toBeNull()
    expect(screen.queryByText(/they.ll (be )?(told|notified|alerted)/i)).toBeNull()
    expect(screen.queryByText(/they won.t know/i)).toBeNull()
  })

  it('copy is identical regardless of blockerUserId/blockedUserId identity (no blocked-vs-removed asymmetry)', () => {
    const { unmount } = render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-a',
        blockedUserId: 'aaaaaaaa-0000-0000-0000-000000000000',
      })
    )
    const firstDesc = document.querySelector('[data-dialog-desc="true"]')?.textContent ?? ''
    unmount()

    render(
      React.createElement(BlockUserConfirmDialog, {
        open: true,
        onOpenChange: vi.fn(),
        blockerUserId: 'blocker-z',
        blockedUserId: 'bbbbbbbb-0000-0000-0000-000000000000',
      })
    )
    const secondDesc = document.querySelector('[data-dialog-desc="true"]')?.textContent ?? ''

    // Strip the identity-specific slice; the surrounding copy must be identical.
    const normalize = (s: string) => s.replace(/[a-zA-Z0-9]{8}/, '<id>')
    expect(normalize(firstDesc)).toBe(normalize(secondDesc))
  })
})
