// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/notifications/InAppReminderGate.tsx` —
 * the web/desktop-only in-app reminder card that surfaces pending
 * streak / unread-reply / moderation-receipt categories on Home when there is
 * something pending, mirroring `StreakReminderPermissionGate.test.tsx` /
 * `ModerationReceiptGate.test.tsx`'s RTL mocking patterns.
 *
 * Red-phase contract: every test MUST fail until the target module (AND its
 * `../unreadReplies`-hook dependency) exist — the whole file fails at the
 * top-level `import { InAppReminderGate } from '../InAppReminderGate'` with a
 * module-resolution error, per this repo's established red-phase convention.
 *
 * Contract this file locks in for the implementation (an inferred contract,
 * since nothing prior pins this component's exact shape — mirrors this repo's
 * established precedent, on prior brand-new modules, of pinning a reasonable
 * inferred shape the implementer can build to or adjust the test against):
 *   - Early-return `null` unless `Platform.OS === 'web'` (covers web + Tauri
 *     desktop; native no-ops even with every category pending).
 *   - `useCurrentUserId()` gates auth: undefined (loading) or null
 *     (logged-out) both render `null`.
 *   - Three pending signals, ALL independently able to render a row:
 *       - streak: `use$(store$.profile)`'s `preferences.reminders.streak`
 *         (`enabled === true`) AND `useTodayWordCount() < 500` AND current
 *         local time is at/past `streak.local_time` (default '20:00'),
 *         compared as minutes-since-midnight — NEVER raw lexicographic
 *         string compare (an unpadded '9:30' would wrongly sort after
 *         '20:00').
 *       - replies: `useUnreadReplies(userId, since).data > 0`.
 *       - moderation: an unacknowledged `useMyActiveSuspension` (re-checking
 *         `ends_at > now` at render) OR an unacknowledged row from
 *         `useMyRemovedPosts`, via `hasAcknowledgedReceipt` +
 *         `suspensionReceiptId` / `removedPostReceiptId` (the SAME signal
 *         `ModerationReceiptGate` reads).
 *   - Renders `null` when no category is pending, or when
 *     `ephemeral$.reminderCardDismissed` is `true` (session dismissal) even
 *     if something IS pending.
 *   - Row testIDs: `reminder-row-streak` / `reminder-row-replies` /
 *     `reminder-row-moderation`; a dismiss affordance `reminder-dismiss` sets
 *     `ephemeral$.reminderCardDismissed.set(true)`.
 *   - Tapping the streak row calls `router.push('/journal')`; the replies row
 *     calls `router.push('/collective')`; the moderation row calls
 *     `router.push(...)` with SOME string target (the exact route is not
 *     pinned by the story — "a lightweight pointer" to the receipt/settings
 *     context).
 *   - The unread-replies `since` bound is captured ONCE per app SESSION (into
 *     `ephemeral$.reminderRepliesSince`), gated on the profile having hydrated
 *     (`store$.profile` non-null): a first hydrated+authenticated mount seeds
 *     `since := getRepliesLastSeenAt() ?? now` and advances `markRepliesSeen(now)`
 *     with the SAME pinned `now`; a later mount in the same session (a Home
 *     bounce) reuses the seeded `since` and does NOT re-advance. Before the
 *     profile hydrates, nothing seeds or advances (the query stays disabled with
 *     a null `since`), so a cold-start hydration race can never freeze `since`
 *     at `now`.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── react-native Platform mock ─────────────────────────────────────────────
let mockPlatformOS = 'web'
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
}))

// ─── solito/navigation ───────────────────────────────────────────────────────
const pushMock = vi.fn()
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

// ─── Legend-State use$ mock — mirrors ModerationReceiptGate/HomeScreen tests ─
vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn((obs: any) => {
    if (obs && typeof obs === 'object' && typeof obs.get === 'function') {
      return obs.get()
    }
    return obs
  }),
}))

// ─── app/state/store mock — profile (reactive) + ephemeral$ dismissal ──────
let mockProfile: any = {
  preferences: { reminders: { streak: { enabled: false } } },
}
let mockDismissed = false
// The session-scoped unread-reply `since` bound. Module-level (survives an
// unmount/remount within a test — a Home bounce) and reset per test.
let mockRepliesSince: string | null = null
const dismissedSetMock = vi.fn((value: boolean) => {
  mockDismissed = value
})
vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      get: () => mockProfile,
      peek: () => mockProfile,
    },
  },
  ephemeral$: {
    reminderCardDismissed: {
      get: () => mockDismissed,
      set: (value: boolean) => dismissedSetMock(value),
    },
    reminderRepliesSince: {
      // Direct assignment (not a resettable spy) so the seeded session bound
      // survives an unmount/remount within a test — a Home bounce.
      peek: () => mockRepliesSince,
      set: (value: string | null) => {
        mockRepliesSince = value
      },
    },
  },
}))

// ─── app/state/collective/currentUser ──────────────────────────────────────
const useCurrentUserIdMock = vi.fn()
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => useCurrentUserIdMock(),
}))

// ─── app/state/collective/todayWordCount ───────────────────────────────────
const useTodayWordCountMock = vi.fn()
vi.mock('app/state/collective/todayWordCount', () => ({
  useTodayWordCount: () => useTodayWordCountMock(),
}))

// ─── app/state/collective/unreadReplies (new hook) ─────────────────────────
const useUnreadRepliesMock = vi.fn()
vi.mock('app/state/collective/unreadReplies', () => ({
  useUnreadReplies: (userId: string | null, since: string | null) =>
    useUnreadRepliesMock(userId, since),
}))

// ─── app/state/collective/suspension + moderationReceipts (reused) ─────────
const useMyActiveSuspensionMock = vi.fn()
vi.mock('app/state/collective/suspension', () => ({
  useMyActiveSuspension: (userId: string | null) => useMyActiveSuspensionMock(userId),
}))

const useMyRemovedPostsMock = vi.fn()
vi.mock('app/state/collective/moderationReceipts', () => ({
  useMyRemovedPosts: (userId: string | null) => useMyRemovedPostsMock(userId),
}))

// ─── moderation-receipts acknowledgment helpers (reused) ───────────────────
const hasAcknowledgedReceiptMock = vi.fn()
vi.mock('../../moderation-receipts/acknowledgment', () => ({
  hasAcknowledgedReceipt: (id: string) => hasAcknowledgedReceiptMock(id),
  removedPostReceiptId: (postId: string, removedAt: string) =>
    `removed_post:${postId}:${removedAt}`,
  suspensionReceiptId: (id: string) => `suspension:${id}`,
}))

// ─── ../reminderPreferences — the since-capture + advance-once writer ──────
const getRepliesLastSeenAtMock = vi.fn()
const markRepliesSeenMock = vi.fn()
vi.mock('../reminderPreferences', () => ({
  getRepliesLastSeenAt: () => getRepliesLastSeenAtMock(),
  markRepliesSeen: (now?: string) => markRepliesSeenMock(now),
}))

// ─── @my/ui mock — Text/YStack/XStack passthroughs, testID -> data-testid ──
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, children, ...rest } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }
  const passthrough = (tag: string) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tag, mapProps(props), children)
    return Component
  }
  return {
    Text: passthrough('span'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
  }
})

// ─── Import under test — fails until InAppReminderGate.tsx exists ─────────
import { InAppReminderGate } from '../InAppReminderGate'

const FIXED_NOW_LOCAL = new Date('2026-07-12T21:30:00') // 21:30 local — past the '20:00' default

beforeEach(() => {
  mockPlatformOS = 'web'
  mockProfile = { preferences: { reminders: { streak: { enabled: false } } } }
  mockDismissed = false
  mockRepliesSince = null
  pushMock.mockReset()
  dismissedSetMock.mockReset()
  useCurrentUserIdMock.mockReset().mockReturnValue('user-1')
  useTodayWordCountMock.mockReset().mockReturnValue(0)
  useUnreadRepliesMock.mockReset().mockReturnValue({ data: 0 })
  useMyActiveSuspensionMock.mockReset().mockReturnValue(null)
  useMyRemovedPostsMock.mockReset().mockReturnValue({ data: [] })
  hasAcknowledgedReceiptMock.mockReset().mockReturnValue(false)
  getRepliesLastSeenAtMock.mockReset().mockReturnValue(undefined)
  markRepliesSeenMock.mockReset()
  // Fake ONLY `Date` (never setTimeout/setInterval) so `waitFor`'s real-timer
  // polling keeps working while `new Date()` inside the component is pinned
  // to a controllable local wall-clock time for the minutes-since-midnight
  // assertions below.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW_LOCAL)
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function enableAllThreeCategories() {
  mockProfile = {
    preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } },
  }
  useTodayWordCountMock.mockReturnValue(0) // < 500, not done today
  useUnreadRepliesMock.mockReturnValue({ data: 2 })
  useMyActiveSuspensionMock.mockReturnValue({
    id: 'susp-1',
    kind: 'post_react',
    starts_at: '2026-06-01T00:00:00.000Z',
    ends_at: '2099-01-01T00:00:00.000Z',
    reason: 'harassment',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Platform gate', () => {
  it('renders null on iOS even with every category pending', () => {
    mockPlatformOS = 'ios'
    enableAllThreeCategories()
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null on Android even with every category pending', () => {
    mockPlatformOS = 'android'
    enableAllThreeCategories()
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders content on web when something is pending', () => {
    enableAllThreeCategories()
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-streak')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Auth-state gating', () => {
  it('renders null when useCurrentUserId() is undefined (session loading)', () => {
    useCurrentUserIdMock.mockReturnValue(undefined)
    enableAllThreeCategories()
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when useCurrentUserId() is null (logged out)', () => {
    useCurrentUserIdMock.mockReturnValue(null)
    enableAllThreeCategories()
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })

  it('does not call markRepliesSeen when logged out', async () => {
    useCurrentUserIdMock.mockReturnValue(null)
    render(<InAppReminderGate />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(markRepliesSeenMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('No pending category', () => {
  it('renders null when nothing is pending', () => {
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Streak pending row', () => {
  it('shows the streak row when enabled, under 500 today, and past local_time', () => {
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-streak')).toBeTruthy()
  })

  it('tapping the streak row navigates to /journal', () => {
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    fireEvent.click(screen.getByTestId('reminder-row-streak'))
    expect(pushMock).toHaveBeenCalledWith('/journal')
  })

  it('does not show the streak row when reminders.streak.enabled is false', () => {
    mockProfile = {
      preferences: { reminders: { streak: { enabled: false, local_time: '20:00' } } },
    }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-streak')).toBeNull()
  })

  it("does not show the streak row when today's 500 is already done (useTodayWordCount >= 500)", () => {
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } } }
    useTodayWordCountMock.mockReturnValue(500)
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-streak')).toBeNull()
  })

  it('minutes-since-midnight compare (NOT lexicographic): before local_time (09:05 local) does not show the row even though enabled and under 500', () => {
    vi.setSystemTime(new Date('2026-07-12T09:05:00'))
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    // A naive lexicographic compare of unpadded '9:5'/'9:05' vs '20:00' would
    // wrongly evaluate as "past the threshold" here ('9' > '2'); the correct
    // minutes-since-midnight compare (545 < 1200) must NOT show the row yet.
    expect(screen.queryByTestId('reminder-row-streak')).toBeNull()
  })

  it('minutes-since-midnight compare: after local_time (21:30 local) shows the row', () => {
    vi.setSystemTime(new Date('2026-07-12T21:30:00'))
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '20:00' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-streak')).toBeTruthy()
  })

  it('falls back to the 20:00 default on a malformed local_time instead of suppressing the row forever (NaN guard)', () => {
    // A corrupt '8' yields NaN minutes; `currentMinutes >= NaN` is always false,
    // which would hide the streak reminder permanently. The fallback treats it
    // as the '20:00' default, so at 21:30 (past 20:00) the row still shows.
    vi.setSystemTime(new Date('2026-07-12T21:30:00'))
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '8' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-streak')).toBeTruthy()
  })

  it('a malformed local_time still respects the default threshold before 20:00 (09:05 local → no row)', () => {
    vi.setSystemTime(new Date('2026-07-12T09:05:00'))
    mockProfile = { preferences: { reminders: { streak: { enabled: true, local_time: '' } } } }
    useTodayWordCountMock.mockReturnValue(100)
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-streak')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Replies pending row', () => {
  it('shows the replies row when useUnreadReplies().data > 0', () => {
    useUnreadRepliesMock.mockReturnValue({ data: 3 })
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-replies')).toBeTruthy()
  })

  it('tapping the replies row navigates to /collective', () => {
    useUnreadRepliesMock.mockReturnValue({ data: 1 })
    render(<InAppReminderGate />)
    fireEvent.click(screen.getByTestId('reminder-row-replies'))
    expect(pushMock).toHaveBeenCalledWith('/collective')
  })

  it('does not show the replies row when the count is 0', () => {
    useUnreadRepliesMock.mockReturnValue({ data: 0 })
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-replies')).toBeNull()
  })

  it('does not show the replies row while the count is still loading (data undefined)', () => {
    useUnreadRepliesMock.mockReturnValue({ data: undefined })
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-replies')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Moderation pending row', () => {
  const SUSPENSION_ROW = {
    id: 'susp-1',
    kind: 'post_react',
    starts_at: '2026-06-01T00:00:00.000Z',
    ends_at: '2099-01-01T00:00:00.000Z',
    reason: 'harassment',
  }
  const REMOVED_POST = {
    id: 'post-1',
    parent_post_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    removed_reason: 'spam',
    removed_at: '2026-07-02T00:00:00.000Z',
  }

  it('shows the moderation row for an active, unacknowledged suspension', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-moderation')).toBeTruthy()
  })

  it('tapping the moderation row calls router.push with some target', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    render(<InAppReminderGate />)
    fireEvent.click(screen.getByTestId('reminder-row-moderation'))
    expect(pushMock).toHaveBeenCalledWith(expect.any(String))
  })

  it('re-checks ends_at at render: a lapsed suspension in stale cache is NOT treated as pending', () => {
    useMyActiveSuspensionMock.mockReturnValue({
      ...SUSPENSION_ROW,
      ends_at: '2020-01-01T00:00:00.000Z',
    })
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-moderation')).toBeNull()
  })

  it('does not show the moderation row when the suspension is already acknowledged and there are no removed posts', () => {
    useMyActiveSuspensionMock.mockReturnValue(SUSPENSION_ROW)
    hasAcknowledgedReceiptMock.mockImplementation((id: string) => id === 'suspension:susp-1')
    render(<InAppReminderGate />)
    expect(screen.queryByTestId('reminder-row-moderation')).toBeNull()
  })

  it('shows the moderation row for an unacknowledged removed post (no suspension)', () => {
    useMyRemovedPostsMock.mockReturnValue({ data: [REMOVED_POST] })
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-moderation')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Multiple pending categories at once', () => {
  it('renders all three rows simultaneously when all are pending', () => {
    enableAllThreeCategories()
    render(<InAppReminderGate />)
    expect(screen.getByTestId('reminder-row-streak')).toBeTruthy()
    expect(screen.getByTestId('reminder-row-replies')).toBeTruthy()
    expect(screen.getByTestId('reminder-row-moderation')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Session dismissal (ephemeral$.reminderCardDismissed)', () => {
  it('tapping dismiss calls ephemeral$.reminderCardDismissed.set(true)', () => {
    enableAllThreeCategories()
    render(<InAppReminderGate />)
    fireEvent.click(screen.getByTestId('reminder-dismiss'))
    expect(dismissedSetMock).toHaveBeenCalledWith(true)
  })

  it('renders null when dismissed is already true, even though something is pending', () => {
    mockDismissed = true
    enableAllThreeCategories()
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when dismissed is true and nothing is pending (still null, no crash)', () => {
    mockDismissed = true
    const { container } = render(<InAppReminderGate />)
    expect(container.firstChild).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('since capture + markRepliesSeen advance sequencing', () => {
  // The last non-null `since` the query was called with (the query starts
  // disabled with a null `since` until the session bound is seeded).
  const lastSince = () =>
    useUnreadRepliesMock.mock.calls
      .map((call) => call[1])
      .filter((v) => v != null)
      .at(-1)

  it('pins ONE `now` for both the null-since default AND the markRepliesSeen advance on a first-ever open', async () => {
    getRepliesLastSeenAtMock.mockReturnValue(undefined)
    render(<InAppReminderGate />)

    await waitFor(() => expect(markRepliesSeenMock).toHaveBeenCalledTimes(1))
    const nowArgWritten = markRepliesSeenMock.mock.calls[0]?.[0]

    expect(typeof nowArgWritten).toBe('string')
    // The query's seeded `since` equals the SAME pinned `now` written to advance
    // — so a first-ever open counts exactly zero.
    expect(lastSince()).toBe(nowArgWritten)
  })

  it('uses the STORED repliesLastSeenAt (not now) as `since` when present, while still advancing markRepliesSeen to a fresh value', async () => {
    const stored = '2020-01-01T00:00:00.000Z'
    getRepliesLastSeenAtMock.mockReturnValue(stored)
    render(<InAppReminderGate />)

    await waitFor(() => expect(markRepliesSeenMock).toHaveBeenCalledTimes(1))
    expect(lastSince()).toBe(stored)
    const nowArgWritten = markRepliesSeenMock.mock.calls[0]?.[0]
    expect(nowArgWritten).not.toBe(stored)
  })

  it('does not re-fire markRepliesSeen or re-key the seeded `since` on a later re-render (session-scoped, non-reactive capture)', async () => {
    getRepliesLastSeenAtMock.mockReturnValue(undefined)
    const { rerender } = render(<InAppReminderGate />)
    await waitFor(() => expect(markRepliesSeenMock).toHaveBeenCalledTimes(1))

    rerender(<InAppReminderGate />)
    rerender(<InAppReminderGate />)

    expect(markRepliesSeenMock).toHaveBeenCalledTimes(1)
    const uniqueSeeded = new Set(
      useUnreadRepliesMock.mock.calls.map((call) => call[1]).filter((v) => v != null)
    )
    expect(uniqueSeeded.size).toBe(1)
  })

  it('advances only ONCE per session across a Home unmount/remount (not once per mount)', async () => {
    getRepliesLastSeenAtMock.mockReturnValue(undefined)
    const first = render(<InAppReminderGate />)
    await waitFor(() => expect(markRepliesSeenMock).toHaveBeenCalledTimes(1))
    const seededNow = markRepliesSeenMock.mock.calls[0]?.[0]
    first.unmount()

    // Remount = a Home bounce within the same session (ephemeral bound persists).
    render(<InAppReminderGate />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Still advanced only once — the second mount reused the session bound.
    expect(markRepliesSeenMock).toHaveBeenCalledTimes(1)
    expect(lastSince()).toBe(seededNow)
  })

  it('does NOT seed or advance until the profile has hydrated — a null profile leaves the query disabled and never advances', async () => {
    mockProfile = null // profile not yet hydrated from IndexedDB
    getRepliesLastSeenAtMock.mockReturnValue('2020-01-01T00:00:00.000Z')
    render(<InAppReminderGate />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(markRepliesSeenMock).not.toHaveBeenCalled()
    // Every call used a null `since` (query disabled) — nothing was frozen at now.
    const sinceValues = useUnreadRepliesMock.mock.calls.map((call) => call[1])
    expect(sinceValues.every((v) => v == null)).toBe(true)
  })

  it('captures the STORED repliesLastSeenAt once the profile hydrates, not a frozen now (the cold-start race fix)', async () => {
    const stored = '2020-01-01T00:00:00.000Z'
    getRepliesLastSeenAtMock.mockReturnValue(stored)
    mockProfile = null // hydration loses the race at first render
    const { rerender } = render(<InAppReminderGate />)
    expect(markRepliesSeenMock).not.toHaveBeenCalled()

    // Profile hydrates → the seed runs against the real persisted bound.
    mockProfile = { preferences: { reminders: { streak: { enabled: false } } } }
    rerender(<InAppReminderGate />)

    await waitFor(() => expect(markRepliesSeenMock).toHaveBeenCalledTimes(1))
    expect(lastSince()).toBe(stored)
  })
})
