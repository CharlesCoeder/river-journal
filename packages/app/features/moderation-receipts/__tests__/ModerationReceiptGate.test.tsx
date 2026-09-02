// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation-receipts/ModerationReceiptGate.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { ModerationReceiptGate }
 * from '../ModerationReceiptGate'` with a module-resolution error.
 *
 * Contract this file locks in for the implementation:
 *   - Composes `useCurrentUserId()` + `useMyRemovedPosts()` +
 *     `useMyActiveSuspension()` at the component layer.
 *   - Renders `null` when `userId` is not a `string` (undefined=loading,
 *     null=logged-out) — never mounts pre-auth.
 *   - Builds an ordered receipt queue: suspension FIRST (if active AND not
 *     lapsed), then removed posts (assumed newest-first per the RPC's own
 *     ordering), filters out anything `hasAcknowledgedReceipt` already
 *     covers, and renders `ModerationReceiptDialog` for the FIRST remaining
 *     receipt only (never more than one at a time).
 *   - `onAcknowledge` calls `acknowledgeReceipt(receiptId)` built via the
 *     SAME `removedPostReceiptId` / `suspensionReceiptId` helpers used by the
 *     data layer (raw `removed_at`, never reformatted) and advances the
 *     queue to the next unacknowledged receipt.
 *   - Render-time expiry guard: a suspension row whose `ends_at` is already
 *     in the past (stale TQ cache, up to 60s) is treated as NO active
 *     suspension — never shown as "paused until {a past date}".
 *   - Renders `null` when the queue is empty.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Mock the data-layer hooks ─────────────────────────────────────────────
const useCurrentUserIdMock = vi.fn()
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => useCurrentUserIdMock(),
}))

const useMyRemovedPostsMock = vi.fn()
vi.mock('app/state/collective/moderationReceipts', () => ({
  useMyRemovedPosts: (userId: string | null) => useMyRemovedPostsMock(userId),
}))

const useMyActiveSuspensionMock = vi.fn()
vi.mock('app/state/collective/suspension', () => ({
  useMyActiveSuspension: (userId: string | null) => useMyActiveSuspensionMock(userId),
  // useIsSuspended may be transitively imported elsewhere; keep the module shape safe.
  useIsSuspended: () => undefined,
}))

// ─── Mock the acknowledgment (Legend-State) helpers ────────────────────────
const hasAcknowledgedReceiptMock = vi.fn()
const acknowledgeReceiptMock = vi.fn()
vi.mock('../acknowledgment', () => ({
  hasAcknowledgedReceipt: (id: string) => hasAcknowledgedReceiptMock(id),
  acknowledgeReceipt: (id: string, now?: string) => acknowledgeReceiptMock(id, now),
  removedPostReceiptId: (postId: string, removedAt: string) =>
    `removed_post:${postId}:${removedAt}`,
  suspensionReceiptId: (id: string) => `suspension:${id}`,
}))

// ─── Mock ModerationReceiptDialog — capture props, expose a dismiss button ──
const dialogPropsLog: Array<{ receipt: any; onAcknowledge: () => void }> = []
vi.mock('../ModerationReceiptDialog', () => ({
  ModerationReceiptDialog: (props: any) => {
    dialogPropsLog.push(props)
    return React.createElement(
      'div',
      {
        'data-testid': 'receipt-dialog',
        'data-receipt-kind': props.receipt?.kind,
        'data-receipt-id': props.receipt?.id,
      },
      React.createElement(
        'button',
        { onClick: props.onAcknowledge, 'data-testid': 'dialog-dismiss' },
        'Got it'
      )
    )
  },
}))

// ─── Import under test — fails until ModerationReceiptGate.tsx exists ────────
import { ModerationReceiptGate } from '../ModerationReceiptGate'

// The shared "active suspension" fixture. `ends_at` MUST stay far-future: the
// gate applies a render-time expiry guard (`ends_at > Date.now()`), so a merely
// near-future date silently turns every case below into the no-suspension path
// once real wall-clock passes it. Use the file's sentinel convention — 2099 for
// active, 2020 for lapsed — never a date near "now" at authoring time.
const SUSPENSION_ROW = {
  id: 'susp-1',
  kind: 'post_react',
  starts_at: '2026-06-01T00:00:00.000Z',
  ends_at: '2099-01-01T00:00:00.000Z',
  reason: 'harassment',
}

const REMOVED_POST_NEWER = {
  id: 'post-newer',
  parent_post_id: null,
  created_at: '2026-06-20T00:00:00.000Z',
  removed_reason: 'spam',
  removed_at: '2026-06-21T00:00:00.000Z',
}

const REMOVED_POST_OLDER = {
  id: 'post-older',
  parent_post_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  removed_reason: 'other',
  removed_at: '2026-06-02T00:00:00.000Z',
}

beforeEach(() => {
  useCurrentUserIdMock.mockReset()
  useMyRemovedPostsMock.mockReset()
  useMyActiveSuspensionMock.mockReset()
  hasAcknowledgedReceiptMock.mockReset()
  acknowledgeReceiptMock.mockReset()
  dialogPropsLog.length = 0

  // Sane defaults: authenticated, no suspension, no removed posts, nothing acknowledged.
  useCurrentUserIdMock.mockReturnValue('user-1')
  useMyActiveSuspensionMock.mockReturnValue(null)
  useMyRemovedPostsMock.mockReturnValue({ data: [] })
  hasAcknowledgedReceiptMock.mockReturnValue(false)
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Auth-state gating', () => {
  it('renders null when userId is undefined (session still loading)', () => {
    useCurrentUserIdMock.mockReturnValue(undefined)
    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when userId is null (logged out)', () => {
    useCurrentUserIdMock.mockReturnValue(null)
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })
    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })

  it('does not call the data hooks with a non-string userId in a way that would surface a receipt pre-auth', () => {
    useCurrentUserIdMock.mockReturnValue(null)
    render(<ModerationReceiptGate />)
    expect(screen.queryByTestId('receipt-dialog')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Empty queue', () => {
  it('renders null when there is no active suspension and no removed posts', () => {
    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when every receipt in the queue is already acknowledged', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })
    hasAcknowledgedReceiptMock.mockReturnValue(true)
    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Queue ordering — suspension first', () => {
  it('shows the suspension receipt before any removed-post receipt when both are unacknowledged', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER, REMOVED_POST_OLDER] })
    render(<ModerationReceiptGate />)

    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-kind')).toBe('suspension')
    expect(dialog.getAttribute('data-receipt-id')).toBe('susp-1')
  })

  it('shows the first removed post when there is no active suspension', () => {
    useMyActiveSuspensionMock.mockReturnValue(null)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER, REMOVED_POST_OLDER] })
    render(<ModerationReceiptGate />)

    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-kind')).toBe('removed_post')
    expect(dialog.getAttribute('data-receipt-id')).toBe('post-newer')
  })

  it('renders exactly ONE dialog at a time even when both a suspension and multiple removed posts are unacknowledged (calm queue)', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER, REMOVED_POST_OLDER] })
    render(<ModerationReceiptGate />)
    expect(screen.getAllByTestId('receipt-dialog')).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Acknowledged-receipt suppression (never re-appear)', () => {
  it('skips an already-acknowledged suspension receipt and falls through to removed posts', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })
    hasAcknowledgedReceiptMock.mockImplementation((id: string) => id === 'suspension:susp-1')

    render(<ModerationReceiptGate />)
    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-kind')).toBe('removed_post')
  })

  it('an acknowledged suspension while still active does not re-surface, and renders null if no removed posts remain', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [] })
    hasAcknowledgedReceiptMock.mockImplementation((id: string) => id === 'suspension:susp-1')

    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })

  it('skips an already-acknowledged removed-post receipt and shows the next unacknowledged one', () => {
    useMyActiveSuspensionMock.mockReturnValue(null)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER, REMOVED_POST_OLDER] })
    hasAcknowledgedReceiptMock.mockImplementation(
      (id: string) => id === `removed_post:post-newer:${REMOVED_POST_NEWER.removed_at}`
    )

    render(<ModerationReceiptGate />)
    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-id')).toBe('post-older')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Render-time expiry guard for suspension', () => {
  it('treats a suspension row whose ends_at is already in the past as inactive (no receipt shown for it)', () => {
    const lapsedRow = { ...SUSPENSION_ROW, ends_at: '2020-01-01T00:00:00.000Z' }
    useMyActiveSuspensionMock.mockReturnValue(lapsedRow)
    useMyRemovedPostsMock.mockReturnValue({ data: [] })

    const { container } = render(<ModerationReceiptGate />)
    expect(container.firstChild).toBeNull()
  })

  it('falls through to a removed-post receipt when the suspension is lapsed but removed posts remain', () => {
    const lapsedRow = { ...SUSPENSION_ROW, ends_at: '2020-01-01T00:00:00.000Z' }
    useMyActiveSuspensionMock.mockReturnValue(lapsedRow)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })

    render(<ModerationReceiptGate />)
    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-kind')).toBe('removed_post')
  })

  it('shows the suspension receipt when ends_at is still in the future', () => {
    const activeRow = { ...SUSPENSION_ROW, ends_at: '2099-01-01T00:00:00.000Z' }
    useMyActiveSuspensionMock.mockReturnValue(activeRow)
    useMyRemovedPostsMock.mockReturnValue({ data: [] })

    render(<ModerationReceiptGate />)
    const dialog = screen.getByTestId('receipt-dialog')
    expect(dialog.getAttribute('data-receipt-kind')).toBe('suspension')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('onAcknowledge — writes via the shared receiptId builders and advances the queue', () => {
  it('acknowledging the suspension receipt calls acknowledgeReceipt("suspension:<id>")', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [] })

    render(<ModerationReceiptGate />)
    fireEvent.click(screen.getByTestId('dialog-dismiss'))

    expect(acknowledgeReceiptMock).toHaveBeenCalledWith('suspension:susp-1', undefined)
  })

  it('acknowledging a removed-post receipt calls acknowledgeReceipt with the RAW removed_at in the key', () => {
    useMyActiveSuspensionMock.mockReturnValue(null)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })

    render(<ModerationReceiptGate />)
    fireEvent.click(screen.getByTestId('dialog-dismiss'))

    expect(acknowledgeReceiptMock).toHaveBeenCalledWith(
      `removed_post:post-newer:${REMOVED_POST_NEWER.removed_at}`,
      undefined
    )
  })

  it('after acknowledging the suspension, the gate advances to show the next removed-post receipt', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST_NEWER] })
    // hasAcknowledgedReceipt starts false for everything; once the dismiss
    // button is pressed the component re-derives its filtered list using the
    // (now-updated) mock so the test can observe the advance.
    let suspensionAcked = false
    hasAcknowledgedReceiptMock.mockImplementation((id: string) =>
      id === 'suspension:susp-1' ? suspensionAcked : false
    )
    acknowledgeReceiptMock.mockImplementation((id: string) => {
      if (id === 'suspension:susp-1') suspensionAcked = true
    })

    const { rerender } = render(<ModerationReceiptGate />)
    expect(screen.getByTestId('receipt-dialog').getAttribute('data-receipt-kind')).toBe(
      'suspension'
    )

    fireEvent.click(screen.getByTestId('dialog-dismiss'))
    rerender(<ModerationReceiptGate />)

    expect(screen.getByTestId('receipt-dialog').getAttribute('data-receipt-kind')).toBe(
      'removed_post'
    )
  })
})
