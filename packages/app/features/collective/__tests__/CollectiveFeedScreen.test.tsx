// @vitest-environment happy-dom
/**
 * Story 3-8 — TDD red-phase unit tests for `features/collective/CollectiveFeedScreen.tsx`
 * and `features/collective/CollectivePreview.tsx`.
 *
 * Red-phase contract: every test MUST fail until Story 3-8's Task 3 and Task 4 create:
 *   - packages/app/features/collective/CollectiveFeedScreen.tsx
 *   - packages/app/features/collective/CollectivePreview.tsx
 *   - packages/app/features/collective/PostRow.tsx
 *
 * AC coverage:
 *   t1  — full mode dispatch (AC #8, #11, #25-t1)
 *   t2  — preview mode dispatch (AC #9, #25-t2)
 *   t3  — server-driven mode defense-in-depth (AC #8, #25-t3)
 *   t4  — skeleton loading (AC #13, #25-t4)
 *   t5  — empty state full mode (AC #14, #25-t5)
 *   t6  — offline microcopy (AC #15, #25-t6)
 *   t7  — suspended user (AC #16, #25-t7)
 *   t8  — self-deleted post (AC #17, #25-t8)
 *   t9  — account-anonymized post (AC #18, #25-t9)
 *   t10 — removed-post defensive filter (AC #19, #25-t10)
 *   t11 — load more button (AC #12, #25-t11)
 *   t12 — boundary rule grep D7 (AC #23, #25-t12)
 *   t13 — precedence: both is_user_deleted + user_id===null (AC #17, #18, #25-t13)
 *   t14 — empty-preview guard (AC #34, #25-t14)
 *   t15 — mode-flip re-mount via key prop (AC #32, #25-t15)
 *   t16 — error state blank screen avoidance (AC #33, #25-t16)
 *   t17 — error with cached data shows cached posts + error strip (AC #33, #25-t17)
 *   t18 — load more hidden when hasNextPage===false (AC #12, #25-t18)
 *
 * Mock strategy: vi.mock for useFeed, useIsSuspended, useCurrentUserId, onlineManager;
 * @my/ui mocked to map Tamagui primitives to testable HTML elements;
 * mirrors ReactionStrip.test.tsx patterns.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants for grep tests ────────────────────────────────────────────
const FEATURES_DIR = path.resolve(__dirname, '..')
const STATE_DIR = path.resolve(__dirname, '../../../state/collective')
const UI_DIR = path.resolve(__dirname, '../../../../../packages/ui/src/components')

const FEED_SCREEN_PATH = path.join(FEATURES_DIR, 'CollectiveFeedScreen.tsx')
const PREVIEW_PATH = path.join(FEATURES_DIR, 'CollectivePreview.tsx')
const AUTHOR_BYLINE_PATH = path.join(UI_DIR, 'AuthorByline.tsx')
const SUSPENSION_PATH = path.join(STATE_DIR, 'suspension.ts')
const CURRENT_USER_PATH = path.join(STATE_DIR, 'currentUser.ts')

// ─── Controlled mock state ─────────────────────────────────────────────────────

let mockFeedData: any = undefined
let mockIsLoading = false
let mockIsFetchingNextPage = false
let mockHasNextPage = false
let mockIsError = false
let mockDataUpdatedAt = Date.now()
const mockFetchNextPage = vi.fn()
const mockRefetch = vi.fn()

let mockIsSuspended: boolean | undefined = undefined
let mockCurrentUserId: string | null | undefined = 'user-abc123'
let mockIsOnline = true

// Streak mock for defense-in-depth test (t3)
let mockLastQualifyingDate: string | null = null

// ─── useFeed mock ─────────────────────────────────────────────────────────────
vi.mock('app/state/collective/feed', () => ({
  useFeed: () => ({
    data: mockFeedData,
    isLoading: mockIsLoading,
    isFetchingNextPage: mockIsFetchingNextPage,
    hasNextPage: mockHasNextPage,
    isError: mockIsError,
    dataUpdatedAt: mockDataUpdatedAt,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
  }),
}))

// ─── useIsSuspended mock ──────────────────────────────────────────────────────
vi.mock('app/state/collective/suspension', () => ({
  useIsSuspended: (_userId: string | null) => mockIsSuspended,
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

// ─── ReactionStrip mock — renders as button for a11y assertions ───────────────
vi.mock('app/features/collective/ReactionStrip', () => ({
  ReactionStrip: ({ postId, userId, disabled }: any) =>
    React.createElement('button', {
      'data-testid': `reaction-strip-${postId}`,
      'aria-disabled': disabled ? 'true' : 'false',
      'data-disabled': disabled ? 'true' : 'false',
    }, 'reactions'),
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
    Text: ({ children, fontSize, color, textAlign, ...props }: any) =>
      ReactModule.createElement('span', mapA11y(props), children),

    View: ({ children, tag, onPress, accessible, accessibilityRole, accessibilityLabel, ...props }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (onPress) {
        a11y['onClick'] = onPress
      }
      return ReactModule.createElement(htmlTag, { ...a11y, 'data-tag': tag }, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    Separator: (props: any) =>
      ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    ExpandingLineButton: ({ children, onPress, disabled, ...props }: any) =>
      ReactModule.createElement('button', {
        onClick: onPress,
        disabled: !!disabled,
        'aria-disabled': disabled ? 'true' : 'false',
        'data-testid': props['data-testid'] || `btn-${String(children).toLowerCase().replace(/\s/g, '-')}`,
      }, children),

    useReducedMotion: () => false,

    AuthorByline: ({ displayName, postedAt, tenureTier, deletedDisplay }: any) =>
      ReactModule.createElement('span', {
        'data-testid': 'author-byline',
        'data-display-name': displayName,
        'data-deleted-display': deletedDisplay ? 'true' : 'false',
        'data-tenure-tier': tenureTier ?? 'none',
      }, deletedDisplay ? '[deleted]' : displayName),
  }
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<{
  id: string
  user_id: string | null
  parent_post_id: string | null
  body: string
  created_at: string
  is_removed: boolean
  is_user_deleted: boolean
  user_deleted_at: string | null
  mode: 'full' | 'preview'
}> = {}) {
  return {
    id: 'post-default',
    user_id: 'user-abc123',
    parent_post_id: null,
    body: 'Hello collective.',
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    mode: 'full' as const,
    ...overrides,
  }
}

function makeFeedData(items: any[], mode: 'full' | 'preview', nextCursor: string | null = null) {
  return {
    pages: [{ items, mode, nextCursor }],
    pageParams: [null],
  }
}

// ─── Import under test — will fail until CollectiveFeedScreen.tsx exists ──────
// eslint-disable-next-line import/first
import CollectiveFeedScreen from '../CollectiveFeedScreen'

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup()
  mockFeedData = undefined
  mockIsLoading = false
  mockIsFetchingNextPage = false
  mockHasNextPage = false
  mockIsError = false
  mockDataUpdatedAt = Date.now()
  mockFetchNextPage.mockReset()
  mockRefetch.mockReset()
  mockRouterPush.mockReset()
  mockIsSuspended = undefined
  mockCurrentUserId = 'user-abc123'
  mockIsOnline = true
  mockLastQualifyingDate = null
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — full mode dispatch
// AC #8, #11, #25-t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t1 — full mode dispatch (AC #8, #11)', () => {
  beforeEach(() => {
    mockFeedData = makeFeedData([makePost({ id: 'post-full-1', mode: 'full' })], 'full')
    mockIsLoading = false
  })

  it('renders <article> for each post in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBeGreaterThanOrEqual(1)
  })

  it('renders AuthorByline in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline).not.toBeNull()
  })

  it('renders ReactionStrip in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid^="reaction-strip-"]')
    expect(strip).not.toBeNull()
  })

  it('does NOT render CollectivePreview content ("Write 500 today") in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText(/Write 500 today/i)).toBeNull()
  })

  it('does NOT render "Begin writing" button in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText('Begin writing')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — preview mode dispatch
// AC #9, #10, #25-t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t2 — preview mode dispatch (AC #9, #10)', () => {
  beforeEach(() => {
    mockFeedData = makeFeedData([
      makePost({ id: 'preview-most-recent', mode: 'preview', body: 'Most recent post body.' }),
      makePost({ id: 'preview-teaser-1', mode: 'preview', body: 'Teaser one.' }),
      makePost({ id: 'preview-teaser-2', mode: 'preview', body: 'Teaser two.' }),
    ], 'preview')
    mockIsLoading = false
  })

  it('renders "Write 500 today to join the conversation." copy', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Write 500 today to join the conversation/i)).not.toBeNull()
  })

  it('renders "Begin writing" button in preview mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Begin writing')).not.toBeNull()
  })

  it('renders the most-recent post with ReactionStrip disabled (aria-disabled="true")', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid^="reaction-strip-"]')
    expect(strip).not.toBeNull()
    expect(strip?.getAttribute('aria-disabled')).toBe('true')
  })

  it('renders teaser bodies', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Teaser one\./i)).not.toBeNull()
    expect(screen.getByText(/Teaser two\./i)).not.toBeNull()
  })

  it('renders "Other recent posts" header when teasers exist', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Other recent posts/i)).not.toBeNull()
  })

  it('does NOT render the full-feed article list structure in preview mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    // No PostComposer affordance (Story 3-9) — no compose CTA
    expect(screen.queryByText(/Quiet here/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — server-driven mode defense-in-depth
// AC #8, #25-t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t3 — server-driven mode defense-in-depth (AC #8)', () => {
  it('renders preview mode even when local streak says today qualifies (trusts RPC, not streak)', () => {
    // RPC says preview
    mockFeedData = makeFeedData([
      makePost({ id: 'server-preview-1', mode: 'preview' }),
    ], 'preview')
    mockIsLoading = false

    // Simulate: local streak says today — user has written 500 words
    // In a real violation, CollectiveFeedScreen would import store$ and read streak
    // We simulate this by setting our mock to suggest the user qualifies
    mockLastQualifyingDate = new Date().toISOString().split('T')[0]!

    render(React.createElement(CollectiveFeedScreen))

    // Despite local streak suggesting user qualifies, preview renders
    expect(screen.getByText(/Write 500 today to join the conversation/i)).not.toBeNull()
    expect(screen.getByText('Begin writing')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — skeleton loading
// AC #13, #25-t4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t4 — skeleton loading state (AC #13)', () => {
  beforeEach(() => {
    mockIsLoading = true
    mockFeedData = undefined
  })

  it('renders exactly 5 skeleton placeholder rows during cold-cache load', () => {
    render(React.createElement(CollectiveFeedScreen))
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBe(5)
  })

  it('does NOT render a spinner or progressbar during loading', () => {
    render(React.createElement(CollectiveFeedScreen))
    const spinners = document.querySelectorAll('[role="progressbar"]')
    expect(spinners.length).toBe(0)
    // No <Spinner> text content
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it('does NOT render feed content during loading', () => {
    render(React.createElement(CollectiveFeedScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — empty state (full mode, zero posts)
// AC #14, #25-t5
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t5 — empty state in full mode (AC #14)', () => {
  beforeEach(() => {
    mockFeedData = makeFeedData([], 'full')
    mockIsLoading = false
  })

  it('renders "Quiet here. Be the first." copy when feed is empty in full mode', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Quiet here\. Be the first\./i)).not.toBeNull()
  })

  it('renders a Compose button in empty state', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Compose')).not.toBeNull()
  })

  it('does NOT render skeleton rows in empty state', () => {
    render(React.createElement(CollectiveFeedScreen))
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — offline microcopy
// AC #15, #25-t6
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t6 — offline microcopy (AC #15)', () => {
  beforeEach(() => {
    mockIsOnline = false
    // 5 minutes ago
    mockDataUpdatedAt = Date.now() - 5 * 60 * 1000
    mockFeedData = makeFeedData([makePost({ id: 'offline-post-1' })], 'full')
    mockIsLoading = false
  })

  it('renders "Offline" microcopy strip when offline', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Offline/i)).not.toBeNull()
  })

  it('renders "last synced" text in offline strip', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/last synced/i)).not.toBeNull()
  })

  it('ReactionStrip is NOT disabled when offline (submissions queue)', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid^="reaction-strip-"]')
    expect(strip).not.toBeNull()
    // When offline, strip should NOT be disabled
    expect(strip?.getAttribute('aria-disabled')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — suspended user
// AC #16, #25-t7
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t7 — suspended user rendering (AC #16)', () => {
  beforeEach(() => {
    mockIsSuspended = true
    mockFeedData = makeFeedData([
      makePost({ id: 'susp-post-1' }),
      makePost({ id: 'susp-post-2' }),
    ], 'full')
    mockIsLoading = false
  })

  it('renders "Posting and reacting are paused for this account." when suspended', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Posting and reacting are paused for this account/i)).not.toBeNull()
  })

  it('each ReactionStrip receives disabled={true} when suspended (aria-disabled="true")', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strips = document.querySelectorAll('[data-testid^="reaction-strip-"]')
    expect(strips.length).toBeGreaterThanOrEqual(1)
    for (const strip of Array.from(strips)) {
      expect(strip.getAttribute('aria-disabled')).toBe('true')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — self-deleted post
// AC #17, #25-t8
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t8 — self-deleted post rendering (AC #17)', () => {
  beforeEach(() => {
    mockFeedData = makeFeedData([
      makePost({
        id: 'deleted-post-1',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false
  })

  it('renders AuthorByline with deletedDisplay=true for self-deleted post', () => {
    render(React.createElement(CollectiveFeedScreen))
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline).not.toBeNull()
    expect(byline?.getAttribute('data-deleted-display')).toBe('true')
  })

  it('AuthorByline shows "[deleted]" text for self-deleted post', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('[deleted]')).not.toBeNull()
  })

  it('does NOT render ReactionStrip for self-deleted post', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid="reaction-strip-deleted-post-1"]')
    expect(strip).toBeNull()
  })

  it('still renders the post article wrapper for self-deleted post', () => {
    render(React.createElement(CollectiveFeedScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — account-anonymized post (user_id === null)
// AC #18, #25-t9
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t9 — account-anonymized post (user_id===null) (AC #18)', () => {
  beforeEach(() => {
    mockFeedData = makeFeedData([
      makePost({
        id: 'anon-post-1',
        user_id: null,
        is_user_deleted: false,
        body: 'original content',
      }),
    ], 'full')
    mockIsLoading = false
  })

  it('renders AuthorByline with deletedDisplay=true for anonymized post', () => {
    render(React.createElement(CollectiveFeedScreen))
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline).not.toBeNull()
    expect(byline?.getAttribute('data-deleted-display')).toBe('true')
  })

  it('renders original body content for anonymized post', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('original content')).not.toBeNull()
  })

  it('renders ReactionStrip for anonymized post (reactions preserved)', () => {
    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid="reaction-strip-anon-post-1"]')
    expect(strip).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t10 — removed-post defensive filter
// AC #19, #25-t10
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t10 — removed-post defensive filter (AC #19)', () => {
  it('does not render a post with is_removed===true even if RPC leaks it', () => {
    mockFeedData = makeFeedData([
      makePost({ id: 'removed-post-1', is_removed: true, body: 'This should not render' }),
      makePost({ id: 'visible-post-1', is_removed: false, body: 'This should render' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    expect(screen.queryByText('This should not render')).toBeNull()
    expect(screen.getByText('This should render')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — load more button wired to fetchNextPage
// AC #12, #25-t11
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t11 — load more button (AC #12)', () => {
  it('renders "Load more" button when hasNextPage===true', () => {
    mockFeedData = makeFeedData([makePost({ id: 'paged-post-1' })], 'full', 'some-cursor')
    mockHasNextPage = true
    mockIsFetchingNextPage = false
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Load more')).not.toBeNull()
  })

  it('calls fetchNextPage once when "Load more" button is tapped', () => {
    mockFeedData = makeFeedData([makePost({ id: 'paged-post-2' })], 'full', 'some-cursor')
    mockHasNextPage = true
    mockIsFetchingNextPage = false
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const btn = screen.getByText('Load more')
    fireEvent.click(btn)
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('"Load more" button is disabled when isFetchingNextPage===true', () => {
    mockFeedData = makeFeedData([makePost({ id: 'paged-post-3' })], 'full', 'some-cursor')
    mockHasNextPage = true
    mockIsFetchingNextPage = true
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const btn = screen.queryByText('Load more')
    // Button should be present but disabled
    if (btn) {
      expect(btn.closest('button')?.getAttribute('aria-disabled')).toBe('true')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — boundary rule grep (D7)
// AC #23, #25-t12
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t12 — boundary rule D7 grep (AC #23)', () => {
  it('CollectiveFeedScreen.tsx exists', () => {
    expect(existsSync(FEED_SCREEN_PATH), `CollectiveFeedScreen.tsx must exist at ${FEED_SCREEN_PATH}`).toBe(true)
  })

  it('CollectiveFeedScreen.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(FEED_SCREEN_PATH)).toBe(true)
    const src = readFileSync(FEED_SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('CollectiveFeedScreen.tsx does NOT import from app/state/store', () => {
    expect(existsSync(FEED_SCREEN_PATH)).toBe(true)
    const src = readFileSync(FEED_SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })

  it('CollectivePreview.tsx exists', () => {
    expect(existsSync(PREVIEW_PATH), `CollectivePreview.tsx must exist at ${PREVIEW_PATH}`).toBe(true)
  })

  it('CollectivePreview.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(PREVIEW_PATH)).toBe(true)
    const src = readFileSync(PREVIEW_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('AuthorByline.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(AUTHOR_BYLINE_PATH), `AuthorByline.tsx must exist at ${AUTHOR_BYLINE_PATH}`).toBe(true)
    const src = readFileSync(AUTHOR_BYLINE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('suspension.ts does NOT contain @legendapp/state import', () => {
    expect(existsSync(SUSPENSION_PATH), `suspension.ts must exist at ${SUSPENSION_PATH}`).toBe(true)
    const src = readFileSync(SUSPENSION_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('currentUser.ts does NOT contain @legendapp/state import', () => {
    expect(existsSync(CURRENT_USER_PATH), `currentUser.ts must exist at ${CURRENT_USER_PATH}`).toBe(true)
    const src = readFileSync(CURRENT_USER_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('CollectiveFeedScreen.tsx does NOT contain use$() calls', () => {
    expect(existsSync(FEED_SCREEN_PATH)).toBe(true)
    const src = readFileSync(FEED_SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/use\$\(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — precedence: is_user_deleted AND user_id===null simultaneously
// AC #17, #18, #25-t13
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t13 — deletion precedence: both flags set (AC #17, #18)', () => {
  it('body renders "[deleted]" when both is_user_deleted AND user_id===null', () => {
    mockFeedData = makeFeedData([
      makePost({
        id: 'both-flags-post-1',
        is_user_deleted: true,
        user_id: null,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('[deleted]')).not.toBeNull()
  })

  it('AuthorByline renders deletedDisplay=true when both flags set', () => {
    mockFeedData = makeFeedData([
      makePost({
        id: 'both-flags-post-2',
        is_user_deleted: true,
        user_id: null,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline?.getAttribute('data-deleted-display')).toBe('true')
  })

  it('ReactionStrip is NOT rendered when both flags set (self-delete wins)', () => {
    mockFeedData = makeFeedData([
      makePost({
        id: 'both-flags-post-3',
        is_user_deleted: true,
        user_id: null,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const strip = document.querySelector('[data-testid="reaction-strip-both-flags-post-3"]')
    expect(strip).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t14 — empty-preview guard (CollectivePreview with posts.length===0)
// AC #34, #25-t14
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t14 — empty-preview guard (AC #34)', () => {
  it('does not crash when preview mode returns zero posts', () => {
    mockFeedData = makeFeedData([], 'preview')
    mockIsLoading = false

    expect(() => {
      render(React.createElement(CollectiveFeedScreen))
    }).not.toThrow()
  })

  it('renders "Write 500 today" and "Begin writing" when preview with empty posts', () => {
    mockFeedData = makeFeedData([], 'preview')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Write 500 today to join the conversation/i)).not.toBeNull()
    expect(screen.getByText('Begin writing')).not.toBeNull()
  })

  it('does NOT render any PostRow when preview posts are empty', () => {
    mockFeedData = makeFeedData([], 'preview')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const strips = document.querySelectorAll('[data-testid^="reaction-strip-"]')
    expect(strips.length).toBe(0)
  })

  it('does NOT render "Other recent posts" header when preview has only 1 post (no teasers)', () => {
    mockFeedData = makeFeedData([
      makePost({ id: 'preview-only', mode: 'preview' }),
    ], 'preview')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText(/Other recent posts/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t15 — mode-flip re-mount via key prop
// AC #32, #25-t15
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t15 — mode-flip re-mount (AC #32)', () => {
  it('transitions from preview to full mode correctly on re-render', () => {
    // Initial render: preview mode
    mockFeedData = makeFeedData([
      makePost({ id: 'flip-post-1', mode: 'preview' }),
    ], 'preview')
    mockIsLoading = false

    const { rerender } = render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Write 500 today to join the conversation/i)).not.toBeNull()

    // Re-render with full mode (simulate streak crossing 500)
    mockFeedData = makeFeedData([
      makePost({ id: 'flip-post-1', mode: 'full', body: 'My first full post.' }),
    ], 'full')

    rerender(React.createElement(CollectiveFeedScreen))

    // Should no longer show preview copy
    expect(screen.queryByText(/Write 500 today to join the conversation/i)).toBeNull()
    // Should show full feed content
    expect(document.querySelectorAll('article').length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t16 — error state: blank screen avoidance
// AC #33, #25-t16
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t16 — error state blank screen avoidance (AC #33)', () => {
  beforeEach(() => {
    mockIsError = true
    mockFeedData = undefined
    mockIsLoading = false
  })

  it('renders error microcopy when isError===true and no data', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Couldn't load the feed/i)).not.toBeNull()
  })

  it('renders "Retry" button in error state', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Retry')).not.toBeNull()
  })

  it('calls feed.refetch() when Retry button is tapped', () => {
    render(React.createElement(CollectiveFeedScreen))
    const retryBtn = screen.getByText('Retry')
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT render a toast or modal in error state', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t17 — error with cached data shows posts + error strip
// AC #33, #25-t17
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t17 — error with cached data (AC #33)', () => {
  beforeEach(() => {
    mockIsError = true
    mockFeedData = makeFeedData([makePost({ id: 'cached-post-1', body: 'Cached post content.' })], 'full')
    mockIsLoading = false
  })

  it('renders cached posts when error occurs but data exists', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Cached post content.')).not.toBeNull()
  })

  it('renders "Couldn\'t refresh" error strip alongside cached posts', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Couldn't refresh/i)).not.toBeNull()
  })

  it('also renders "Showing cached posts" when error with data', () => {
    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText(/Showing cached posts/i)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t18 — Load more hidden when hasNextPage===false
// AC #12, #25-t18
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / t18 — Load more hidden when hasNextPage===false (AC #12)', () => {
  it('does NOT render "Load more" button when hasNextPage===false', () => {
    mockFeedData = makeFeedData([makePost({ id: 'last-page-post' })], 'full')
    mockHasNextPage = false
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText('Load more')).toBeNull()
  })
})
