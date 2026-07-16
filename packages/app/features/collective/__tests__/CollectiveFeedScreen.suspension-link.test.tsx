// @vitest-environment happy-dom
/**
 * Covers the AC-9 advisory enhancement to CollectiveFeedScreen: the suspended
 * microcopy strip appends a tappable "View details in Settings" affordance that
 * navigates to /settings. Advisory only — it changes no gating/RLS.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let mockIsSuspended: boolean | undefined = true
const mockRouterPush = vi.fn()

vi.mock('app/state/collective/feed', () => ({
  useFeed: () => ({
    data: { pages: [{ items: [], mode: 'full' }] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}))

vi.mock('app/state/collective/suspension', () => ({
  useIsSuspended: (_userId: string | null) => mockIsSuspended,
}))

vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => 'user-1',
}))

vi.mock('app/state/collective/locallyHidden', () => ({
  useLocallyHiddenPostIds: () => new Set<string>(),
}))

vi.mock('app/state/collective/todayWordCount', () => ({
  useTodayWordCount: () => 500,
}))

vi.mock('app/features/collective/CollectiveLockedScreen', () => ({
  CollectiveLockedScreen: () => React.createElement('div', { 'data-testid': 'locked' }, null),
  glimpseFromPosts: () => [],
}))

vi.mock('app/features/collective/FeedPostRow', () => ({
  FeedPostRow: () => React.createElement('div', { 'data-testid': 'feed-post-row' }, null),
}))

vi.mock('./_shared', () => ({
  SkeletonRows: () => React.createElement('div', { 'data-testid': 'skeleton' }, null),
  formatTimeAgo: () => 'just now',
}))

vi.mock('@tamagui/lucide-icons', () => ({
  PenLine: () => React.createElement('span', { 'data-icon': 'PenLine' }, null),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return { ...actual, onlineManager: { isOnline: () => true } }
})

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, onPress, testID, ...props }: any) => {
      const domProps: Record<string, unknown> = {}
      if (testID) domProps['data-testid'] = testID
      if (onPress) domProps['onClick'] = onPress
      if (props.role) domProps['role'] = props.role
      if (props['aria-label']) domProps['aria-label'] = props['aria-label']
      return ReactModule.createElement(tag, domProps, children)
    }
  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    YStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    XStack: passthrough('div'),
    Separator: passthrough('hr'),
    ScrollView: passthrough('div'),
    ExpandingLineButton: ({ children, onPress }: any) =>
      ReactModule.createElement('button', { onClick: onPress }, children),
    useReducedMotion: () => true,
  }
})

import CollectiveFeedScreen from '../CollectiveFeedScreen'

beforeEach(() => {
  mockIsSuspended = true
  mockRouterPush.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('CollectiveFeedScreen — suspended "View details in Settings" link', () => {
  it('renders the advisory link alongside the paused microcopy when suspended', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Posting and reacting are paused for this account.')).toBeTruthy()
    expect(screen.getByTestId('feed-suspended-details-link')).toBeTruthy()
  })

  it('navigates to /settings when the link is tapped', () => {
    render(React.createElement(CollectiveFeedScreen))
    fireEvent.click(screen.getByTestId('feed-suspended-details-link'))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })

  it('does NOT render the link when the user is not suspended', () => {
    mockIsSuspended = false
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByTestId('feed-suspended-details-link')).toBeNull()
  })
})
