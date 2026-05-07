// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/collective/YourPostsScreen.tsx`
 * and `features/collective/YourPostRow.tsx`.
 *
 * Red-phase contract: every test MUST fail until implementation creates:
 *   - packages/app/features/collective/YourPostsScreen.tsx
 *   - packages/app/features/collective/YourPostRow.tsx
 *   - packages/app/features/collective/_shared.tsx (SkeletonRows + formatTimeAgo)
 *
 * Test plan (t1–t15) is authoritative per Dev Notes.
 *
 * AC coverage:
 *   t1  — posts render in chronological order (AC #1, #2, #3, #4, #5)
 *   t2  — empty state CTA when mode === 'full' (AC #16, #17)
 *   t3  — empty state CTA when mode === 'preview' / undefined (AC #16, #17, #38)
 *   t4  — self-deleted row: [deleted] body + deletion-date marker (AC #10, #11)
 *   t5  — self-deleted row: reaction count suppressed, reply count shown (AC #12)
 *   t6  — engagement counts singular/plural correctness (AC #12)
 *   t7  — skeleton loading on cold cache (AC #18)
 *   t8  — error with no cache: retry button + copy (AC #19)
 *   t9  — error with cached data: strip + posts still visible (AC #20)
 *   t10 — offline strip renders relative time (AC #21)
 *   t11 — strip precedence: error-with-cache beats offline (AC #22)
 *   t12 — load more button visible + calls fetchNextPage (AC #23)
 *   t13 — load more hidden when hasNextPage === false (AC #23)
 *   t14 — tappable row navigates to thread (AC #13)
 *   t15 — boundary rule grep: no @legendapp/state import (AC #1, #30)
 *
 * Mock strategy: vi.mock for useYourPosts, useFeed, useCurrentUserId,
 * onlineManager, solito/router; @my/ui mocked to testable HTML.
 * Mirrors CollectiveFeedScreen.test.tsx patterns exactly.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants for grep tests ────────────────────────────────────────────
const FEATURES_DIR = path.resolve(__dirname, '..')
const YOUR_POSTS_SCREEN_PATH = path.join(FEATURES_DIR, 'YourPostsScreen.tsx')
const YOUR_POST_ROW_PATH = path.join(FEATURES_DIR, 'YourPostRow.tsx')

// ─── Controlled mock state ─────────────────────────────────────────────────────

let mockYourPostsData: any = undefined
let mockYourPostsIsLoading = false
let mockYourPostsIsFetchingNextPage = false
let mockYourPostsHasNextPage = false
let mockYourPostsIsError = false
let mockYourPostsDataUpdatedAt = Date.now()
const mockFetchNextPage = vi.fn()
const mockRefetch = vi.fn()

let mockFeedData: any = undefined

let mockCurrentUserId: string | null | undefined = 'user-abc123'
let mockIsOnline = true

// ─── useYourPosts mock ────────────────────────────────────────────────────────
vi.mock('app/state/collective/yourPosts', () => ({
  useYourPosts: () => ({
    data: mockYourPostsData,
    isLoading: mockYourPostsIsLoading,
    isFetchingNextPage: mockYourPostsIsFetchingNextPage,
    hasNextPage: mockYourPostsHasNextPage,
    isError: mockYourPostsIsError,
    dataUpdatedAt: mockYourPostsDataUpdatedAt,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
  }),
}))

// ─── useFeed mock (consumed only for mode field) ───────────────────────────────
vi.mock('app/state/collective/feed', () => ({
  useFeed: () => ({
    data: mockFeedData,
  }),
}))

// ─── useCurrentUserId mock ────────────────────────────────────────────────────
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

// ─── onlineManager mock ───────────────────────────────────────────────────────
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    onlineManager: {
      isOnline: () => mockIsOnline,
    },
  }
})

// ─── useRouter mock (solito/router) ──────────────────────────────────────────
const mockRouterPush = vi.fn()
vi.mock('solito/router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props['aria-disabled'] !== undefined) out['aria-disabled'] = String(props['aria-disabled'])
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.testID) out['data-testid'] = props.testID
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    if (props.accessibilityRole) out['role'] = props.accessibilityRole
    return out
  }

  return {
    Text: ({ children, fontSize, color, textAlign, fontFamily, ...props }: any) =>
      ReactModule.createElement('span', mapA11y(props), children),

    View: ({
      children,
      tag,
      onPress,
      accessible,
      accessibilityRole,
      accessibilityLabel,
      role,
      'aria-label': ariaLabel,
      ...props
    }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (onPress) a11y['onClick'] = onPress
      return ReactModule.createElement(htmlTag, { ...a11y, 'data-tag': tag }, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

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

    useReducedMotion: () => false,

    AuthorByline: ({ displayName, postedAt, tenureTier, deletedDisplay }: any) =>
      ReactModule.createElement(
        'span',
        {
          'data-testid': 'author-byline',
          'data-display-name': displayName,
          'data-deleted-display': deletedDisplay ? 'true' : 'false',
          'data-tenure-tier': tenureTier ?? 'none',
        },
        deletedDisplay ? '[deleted]' : displayName
      ),

    Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, ...props }: any) =>
      ReactModule.createElement(
        'div',
        {
          onClick: onPress,
          role: accessibilityRole,
          'aria-label': accessibilityLabel,
          'data-testid': 'pressable-wrapper',
        },
        children
      ),
  }
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeYourPost(overrides: Partial<{
  id: string
  user_id: string
  parent_post_id: string | null
  body: string
  created_at: string
  is_removed: boolean
  is_user_deleted: boolean
  user_deleted_at: string | null
  reaction_count: number
  descendant_count: number
  tenure_tier: 30 | 100 | 365 | null
  mode: 'full'
}> = {}) {
  return {
    id: 'your-post-default',
    user_id: 'user-abc123',
    parent_post_id: null,
    body: 'My journal entry.',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    reaction_count: 3,
    descendant_count: 2,
    tenure_tier: null,
    mode: 'full' as const,
    ...overrides,
  }
}

function makeYourPostsData(
  items: ReturnType<typeof makeYourPost>[],
  nextCursor: string | null = null
) {
  return {
    pages: [{ items, nextCursor }],
    pageParams: [null],
  }
}

function makeFeedData(mode: 'full' | 'preview') {
  return {
    pages: [{ items: [], mode, nextCursor: null }],
    pageParams: [null],
  }
}

// ─── Import under test — will fail until YourPostsScreen.tsx exists ───────────
// eslint-disable-next-line import/first
import YourPostsScreen from '../YourPostsScreen'

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup()
  mockYourPostsData = undefined
  mockYourPostsIsLoading = false
  mockYourPostsIsFetchingNextPage = false
  mockYourPostsHasNextPage = false
  mockYourPostsIsError = false
  mockYourPostsDataUpdatedAt = Date.now()
  mockFetchNextPage.mockReset()
  mockRefetch.mockReset()
  mockFeedData = undefined
  mockCurrentUserId = 'user-abc123'
  mockIsOnline = true
  mockRouterPush.mockReset()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — Renders posts in chronological order (newest first)
// AC #1, #2, #3, #4, #5
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — renders posts in chronological order', () => {
  beforeEach(() => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'post-newest', body: 'Newest post.', created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() }),
      makeYourPost({ id: 'post-middle', body: 'Middle post.', created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() }),
      makeYourPost({ id: 'post-oldest', body: 'Oldest post.', created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }),
    ])
    mockYourPostsIsLoading = false
  })

  it('renders an <article> element for each post', () => {
    render(React.createElement(YourPostsScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBeGreaterThanOrEqual(3)
  })

  it('renders all post bodies', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Newest post.')).not.toBeNull()
    expect(screen.getByText('Middle post.')).not.toBeNull()
    expect(screen.getByText('Oldest post.')).not.toBeNull()
  })

  it('renders posts in the order returned by the hook (newest first)', () => {
    render(React.createElement(YourPostsScreen))
    const articles = Array.from(document.querySelectorAll('article'))
    const texts = articles.map((a) => a.textContent ?? '')
    const newestIdx = texts.findIndex((t) => t.includes('Newest post.'))
    const oldestIdx = texts.findIndex((t) => t.includes('Oldest post.'))
    expect(newestIdx).toBeLessThan(oldestIdx)
  })

  it('renders an AuthorByline for each post', () => {
    render(React.createElement(YourPostsScreen))
    const bylines = document.querySelectorAll('[data-testid="author-byline"]')
    expect(bylines.length).toBeGreaterThanOrEqual(3)
  })

  it('does NOT render FlagAffordance on any post row', () => {
    render(React.createElement(YourPostsScreen))
    const flags = document.querySelectorAll('[data-testid^="flag-affordance-"]')
    expect(flags.length).toBe(0)
  })

  it('does NOT render ReactionStrip on any post row', () => {
    render(React.createElement(YourPostsScreen))
    const strips = document.querySelectorAll('[data-testid^="reaction-strip-"]')
    expect(strips.length).toBe(0)
  })

  it('filters out is_removed posts before rendering', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'visible-post', body: 'Visible post.' }),
      makeYourPost({ id: 'removed-post', body: 'Should not appear.', is_removed: true }),
    ])
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Visible post.')).not.toBeNull()
    expect(screen.queryByText('Should not appear.')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — Empty state shows correct CTA when mode === 'full'
// AC #16, #17
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — empty state CTA when mode === full', () => {
  beforeEach(() => {
    mockYourPostsData = makeYourPostsData([])
    mockYourPostsIsLoading = false
    mockFeedData = makeFeedData('full')
  })

  it('renders "You haven\'t posted yet." empty state message', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/You haven't posted yet\./i)).not.toBeNull()
  })

  it('renders "Compose" CTA button in full mode', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Compose')).not.toBeNull()
  })

  it('pressing "Compose" navigates to /collective/compose', () => {
    render(React.createElement(YourPostsScreen))
    const btn = screen.getByText('Compose')
    fireEvent.click(btn)
    expect(mockRouterPush).toHaveBeenCalledWith('/collective/compose')
  })

  it('does NOT render "Begin writing" button in full mode', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.queryByText('Begin writing')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — Empty state shows correct CTA when mode === 'preview' or undefined
// AC #16, #17, #38
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — empty state CTA when mode === preview or feed data undefined', () => {
  beforeEach(() => {
    mockYourPostsData = makeYourPostsData([])
    mockYourPostsIsLoading = false
  })

  it('renders "Begin writing" CTA when mode is preview', () => {
    mockFeedData = makeFeedData('preview')
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Begin writing')).not.toBeNull()
  })

  it('pressing "Begin writing" navigates to / in preview mode', () => {
    mockFeedData = makeFeedData('preview')
    render(React.createElement(YourPostsScreen))
    const btn = screen.getByText('Begin writing')
    fireEvent.click(btn)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('renders "Begin writing" CTA when feed.data is undefined (cold cache fallback)', () => {
    mockFeedData = undefined
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Begin writing')).not.toBeNull()
  })

  it('pressing "Begin writing" navigates to / when feed data is undefined', () => {
    mockFeedData = undefined
    render(React.createElement(YourPostsScreen))
    const btn = screen.getByText('Begin writing')
    fireEvent.click(btn)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('does NOT render "Compose" button when mode is preview', () => {
    mockFeedData = makeFeedData('preview')
    render(React.createElement(YourPostsScreen))
    expect(screen.queryByText('Compose')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — Self-deleted row renders [deleted] body + deletion-date marker
// AC #10, #11
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — self-deleted row renders [deleted] body and deletion-date marker', () => {
  const deletedAt = '2026-05-07T12:00:00Z'

  beforeEach(() => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({
        id: 'deleted-post-1',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: deletedAt,
        reaction_count: 0,
        descendant_count: 4,
      }),
    ])
    mockYourPostsIsLoading = false
  })

  it('renders literal "[deleted]" as the post body', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('[deleted]')).not.toBeNull()
  })

  it('renders the deletion-date marker with correct human-friendly date', () => {
    render(React.createElement(YourPostsScreen))
    // The date "2026-05-07" should be rendered as "May 7, 2026"
    expect(screen.getByText(/you deleted this on May 7, 2026/i)).not.toBeNull()
  })

  it('passes deletedDisplay=true to AuthorByline for self-deleted post', () => {
    render(React.createElement(YourPostsScreen))
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline?.getAttribute('data-deleted-display')).toBe('true')
  })

  it('does NOT render the deletion marker when user_deleted_at is null', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({
        id: 'deleted-no-timestamp',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: null,
      }),
    ])
    render(React.createElement(YourPostsScreen))
    expect(screen.queryByText(/you deleted this on/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — Self-deleted row suppresses reaction count, keeps reply count
// AC #12
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — self-deleted row suppresses reaction count, shows reply count', () => {
  beforeEach(() => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({
        id: 'deleted-with-replies',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: '2026-04-01T09:00:00Z',
        reaction_count: 5,
        descendant_count: 3,
      }),
    ])
    mockYourPostsIsLoading = false
  })

  it('does NOT render any reaction count text for a self-deleted post', () => {
    render(React.createElement(YourPostsScreen))
    // Neither "0 reactions" nor "5 reactions" should appear
    expect(screen.queryByText(/reactions?/i)).toBeNull()
  })

  it('renders the reply count for a self-deleted post', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/3 replies/i)).not.toBeNull()
  })

  it('renders "1 reply" (singular) for self-deleted post with 1 descendant', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({
        id: 'deleted-one-reply',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: '2026-04-01T09:00:00Z',
        reaction_count: 2,
        descendant_count: 1,
      }),
    ])
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/1 reply/i)).not.toBeNull()
    expect(screen.queryByText(/1 replies/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — Engagement counts render with singular/plural correctness
// AC #12
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — engagement count singular/plural correctness', () => {
  it('renders "1 reaction" (singular) and "0 replies" for reaction_count=1, descendant_count=0', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'singular-reaction', reaction_count: 1, descendant_count: 0 }),
    ])
    mockYourPostsIsLoading = false
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/1 reaction/)).not.toBeNull()
    expect(screen.queryByText(/1 reactions/)).toBeNull()
    expect(screen.getByText(/0 replies/)).not.toBeNull()
  })

  it('renders "5 reactions" (plural) and "1 reply" (singular) for reaction_count=5, descendant_count=1', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'plural-reactions', reaction_count: 5, descendant_count: 1 }),
    ])
    mockYourPostsIsLoading = false
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/5 reactions/)).not.toBeNull()
    expect(screen.getByText(/1 reply/)).not.toBeNull()
    expect(screen.queryByText(/1 replies/)).toBeNull()
  })

  it('renders "0 reactions" for a non-deleted post with zero reactions', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'zero-reactions', reaction_count: 0, descendant_count: 0 }),
    ])
    mockYourPostsIsLoading = false
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/0 reactions/)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — Skeleton loading on cold cache
// AC #18
// ─────────────────────────────────────────────────────────────────────────────

describe('t7 — skeleton loading state on cold cache', () => {
  beforeEach(() => {
    mockYourPostsIsLoading = true
    mockYourPostsData = undefined
  })

  it('renders exactly 5 skeleton placeholder rows during cold-cache load', () => {
    render(React.createElement(YourPostsScreen))
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBe(5)
  })

  it('does NOT render a spinner or progressbar during skeleton loading', () => {
    render(React.createElement(YourPostsScreen))
    const spinners = document.querySelectorAll('[role="progressbar"]')
    expect(spinners.length).toBe(0)
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it('does NOT render post content during skeleton loading', () => {
    render(React.createElement(YourPostsScreen))
    expect(document.querySelectorAll('article').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — Error with no cached data: retry button + correct copy
// AC #19
// ─────────────────────────────────────────────────────────────────────────────

describe('t8 — error with no cached data shows retry surface', () => {
  beforeEach(() => {
    mockYourPostsIsError = true
    mockYourPostsData = undefined
    mockYourPostsIsLoading = false
  })

  it('renders the error copy "Couldn\'t load your posts. Pull to retry."', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/Couldn't load your posts\. Pull to retry\./i)).not.toBeNull()
  })

  it('renders a Retry button', () => {
    render(React.createElement(YourPostsScreen))
    const retryBtn = screen.getByText(/Retry/i)
    expect(retryBtn).not.toBeNull()
  })

  it('clicking Retry calls refetch', () => {
    render(React.createElement(YourPostsScreen))
    const retryBtn = screen.getByText(/Retry/i)
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT render post content when there is no cached data', () => {
    render(React.createElement(YourPostsScreen))
    expect(document.querySelectorAll('article').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — Error with cached data: error strip + cached posts still visible
// AC #20
// ─────────────────────────────────────────────────────────────────────────────

describe('t9 — error with cached data shows strip and cached posts', () => {
  beforeEach(() => {
    mockYourPostsIsError = true
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'cached-post-1', body: 'Cached post content.' }),
    ])
    mockYourPostsIsLoading = false
  })

  it('renders the inline ambient error strip copy', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/Couldn't refresh\. Showing cached posts\./i)).not.toBeNull()
  })

  it('still renders cached post rows alongside the error strip', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Cached post content.')).not.toBeNull()
    expect(document.querySelectorAll('article').length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT render the no-cache error copy when data is present', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.queryByText(/Couldn't load your posts\. Pull to retry\./i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t10 — Offline strip renders relative time
// AC #21
// ─────────────────────────────────────────────────────────────────────────────

describe('t10 — offline strip renders relative time', () => {
  beforeEach(() => {
    mockIsOnline = false
    mockYourPostsIsError = false
    mockYourPostsIsLoading = false
    // 5 minutes ago
    mockYourPostsDataUpdatedAt = Date.now() - 5 * 60 * 1000
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'offline-cached-post', body: 'Cached while offline.' }),
    ])
  })

  it('renders "Offline" strip when offline with cached data', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/Offline/i)).not.toBeNull()
  })

  it('renders "last synced" text in the offline strip', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText(/last synced/i)).not.toBeNull()
  })

  it('still renders cached posts when offline', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Cached while offline.')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — Strip precedence: error-with-cache beats offline
// AC #22
// ─────────────────────────────────────────────────────────────────────────────

describe('t11 — strip precedence error-with-cache > offline', () => {
  it('renders ONLY the error strip when both error and offline are true with cached data', () => {
    mockYourPostsIsError = true
    mockIsOnline = false
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'precedence-post', body: 'Precedence test post.' }),
    ])
    mockYourPostsIsLoading = false

    render(React.createElement(YourPostsScreen))

    // Error strip must be present
    expect(screen.getByText(/Couldn't refresh\. Showing cached posts\./i)).not.toBeNull()

    // Offline strip must NOT be present simultaneously
    expect(screen.queryByText(/Offline/i)).toBeNull()
  })

  it('renders the offline strip (not error) when only offline with cached data', () => {
    mockYourPostsIsError = false
    mockIsOnline = false
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'offline-only-post', body: 'Offline only.' }),
    ])
    mockYourPostsDataUpdatedAt = Date.now() - 2 * 60 * 1000
    mockYourPostsIsLoading = false

    render(React.createElement(YourPostsScreen))

    expect(screen.getByText(/Offline/i)).not.toBeNull()
    expect(screen.queryByText(/Couldn't refresh/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — Load more button visible when hasNextPage === true
// AC #23
// ─────────────────────────────────────────────────────────────────────────────

describe('t12 — load more button visible and functional', () => {
  beforeEach(() => {
    mockYourPostsData = makeYourPostsData(
      [makeYourPost({ id: 'paginated-post-1', body: 'Paginated post.' })],
      'some-cursor'
    )
    mockYourPostsHasNextPage = true
    mockYourPostsIsFetchingNextPage = false
    mockYourPostsIsLoading = false
  })

  it('renders "Load more" button when hasNextPage === true', () => {
    render(React.createElement(YourPostsScreen))
    expect(screen.getByText('Load more')).not.toBeNull()
  })

  it('calls fetchNextPage once when "Load more" is clicked', () => {
    render(React.createElement(YourPostsScreen))
    const btn = screen.getByText('Load more')
    fireEvent.click(btn)
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('"Load more" is disabled when isFetchingNextPage === true', () => {
    mockYourPostsIsFetchingNextPage = true
    render(React.createElement(YourPostsScreen))
    const btn = screen.queryByText('Load more')
    if (btn) {
      expect(btn.closest('button')?.getAttribute('aria-disabled')).toBe('true')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — Load more hidden when hasNextPage === false
// AC #23
// ─────────────────────────────────────────────────────────────────────────────

describe('t13 — load more button hidden when hasNextPage === false', () => {
  it('does NOT render "Load more" when hasNextPage === false', () => {
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: 'last-page-post', body: 'Last page.' }),
    ])
    mockYourPostsHasNextPage = false
    mockYourPostsIsLoading = false

    render(React.createElement(YourPostsScreen))
    expect(screen.queryByText('Load more')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t14 — Tappable row navigates to thread
// AC #13
// ─────────────────────────────────────────────────────────────────────────────

describe('t14 — tappable row navigates to thread', () => {
  it('clicking a post row calls router.push with /collective/thread/{post.id}', () => {
    const postId = 'thread-nav-post-abc'
    mockYourPostsData = makeYourPostsData([
      makeYourPost({ id: postId, body: 'Navigate to thread.' }),
    ])
    mockYourPostsIsLoading = false

    render(React.createElement(YourPostsScreen))

    // Find the pressable / clickable wrapper around the article
    // The row wrapper should respond to clicks and call push
    const article = document.querySelector('article')
    expect(article).not.toBeNull()

    // Click the article or its pressable ancestor
    const clickable = article?.closest('[data-testid="pressable-wrapper"]') ?? article
    if (clickable) {
      fireEvent.click(clickable)
    }

    expect(mockRouterPush).toHaveBeenCalledWith(`/collective/thread/${postId}`)
  })

  it('clicking a self-deleted row STILL navigates to thread (thread context is meaningful)', () => {
    const postId = 'deleted-thread-nav-post'
    mockYourPostsData = makeYourPostsData([
      makeYourPost({
        id: postId,
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: '2026-03-01T10:00:00Z',
        descendant_count: 5,
      }),
    ])
    mockYourPostsIsLoading = false

    render(React.createElement(YourPostsScreen))

    const article = document.querySelector('article')
    const clickable = article?.closest('[data-testid="pressable-wrapper"]') ?? article
    if (clickable) {
      fireEvent.click(clickable)
    }

    expect(mockRouterPush).toHaveBeenCalledWith(`/collective/thread/${postId}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t15 — Boundary rule grep: YourPostsScreen.tsx must not import @legendapp/state
// AC #1, #30
// ─────────────────────────────────────────────────────────────────────────────

describe('t15 — boundary rule D7 source-grep', () => {
  it('YourPostsScreen.tsx exists', () => {
    expect(
      existsSync(YOUR_POSTS_SCREEN_PATH),
      `YourPostsScreen.tsx must exist at ${YOUR_POSTS_SCREEN_PATH}`
    ).toBe(true)
  })

  it('YourPostsScreen.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(YOUR_POSTS_SCREEN_PATH)).toBe(true)
    const src = readFileSync(YOUR_POSTS_SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('YourPostsScreen.tsx does NOT import from app/state/store', () => {
    expect(existsSync(YOUR_POSTS_SCREEN_PATH)).toBe(true)
    const src = readFileSync(YOUR_POSTS_SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })

  it('YourPostRow.tsx exists', () => {
    expect(
      existsSync(YOUR_POST_ROW_PATH),
      `YourPostRow.tsx must exist at ${YOUR_POST_ROW_PATH}`
    ).toBe(true)
  })

  it('YourPostRow.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(YOUR_POST_ROW_PATH)).toBe(true)
    const src = readFileSync(YOUR_POST_ROW_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('YourPostRow.tsx does NOT import from app/state/store', () => {
    expect(existsSync(YOUR_POST_ROW_PATH)).toBe(true)
    const src = readFileSync(YOUR_POST_ROW_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})
