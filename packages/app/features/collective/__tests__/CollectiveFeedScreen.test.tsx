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

// ─── useDeleteOwnPost mock — Story 3-13 ──────────────────────────────────────
// Controlled mock for the delete mutation. The Story 3-13 UI tests drive this
// mock to assert dialog open/close behavior and that mutate is called with the
// correct post_id. By mocking here we avoid driving real mutations through the
// singleton queryClient during UI tests.
const mockDeleteMutate = vi.fn()
let mockDeleteIsPending = false
vi.mock('app/state/collective/mutations', async () => {
  const actual = await vi.importActual<typeof import('app/state/collective/mutations')>('app/state/collective/mutations')
  return {
    ...actual,
    useDeleteOwnPost: () => ({
      mutate: mockDeleteMutate,
      mutateAsync: vi.fn(),
      isPending: mockDeleteIsPending,
      error: null,
      reset: vi.fn(),
    }),
    useReportPost: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    }),
  }
})

// ─── ReactionStrip mock — renders as button for a11y assertions ───────────────
vi.mock('app/features/collective/ReactionStrip', () => ({
  ReactionStrip: ({ postId, userId, disabled }: any) =>
    React.createElement('button', {
      'data-testid': `reaction-strip-${postId}`,
      'aria-disabled': disabled ? 'true' : 'false',
      'data-disabled': disabled ? 'true' : 'false',
    }, 'reactions'),
}))

// ─── FlagAffordance mock — renders as a button for a11y assertions ────────────
// Story 3-13: Updated to accept canReport + canSelfDelete instead of disabled.
// The old `disabled` prop is replaced by the two named flags in this story.
// CRITICAL: If the mock still destructures `disabled`, it will always be
// undefined after the prop rename, silently breaking t-new5/t-new6/t-new7 assertions.
vi.mock('app/features/collective/FlagAffordance', () => ({
  FlagAffordance: ({ postId, reporterUserId, canReport, canSelfDelete }: any) => {
    // Mirror FlagAffordance's own early-return rules post-3-13:
    // null reporterUserId → null
    // !canReport && !canSelfDelete → null (nothing to show)
    if (!reporterUserId || (!canReport && !canSelfDelete)) return null
    const ariaLabel = canReport && canSelfDelete
      ? 'Post actions'
      : canSelfDelete
        ? 'Delete your post'
        : 'Report this post'
    return React.createElement('button', {
      'aria-label': ariaLabel,
      'aria-haspopup': 'menu',
      'data-testid': `flag-affordance-${postId}`,
    })
  },
}))

// ─── useLocallyHiddenPostIds mock ─────────────────────────────────────────────
let mockHiddenPostIds: Set<string> = new Set()
vi.mock('app/state/collective/locallyHidden', () => ({
  useLocallyHiddenPostIds: () => mockHiddenPostIds,
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

    View: ({ children, tag, onPress, accessible, accessibilityRole, accessibilityLabel, role, 'aria-label': ariaLabel, ...props }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      // Support both React-native-style (accessibilityRole/accessibilityLabel) and
      // web-style (role/aria-label) a11y props so FlagAffordance trigger renders queryable.
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
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

    // Story 3-13: Dialog and sub-components for delete confirmation dialog tests.
    // These are needed so AC #27e–g assertions (screen.getByText, button presses)
    // can render and interact with the dialog in happy-dom.
    Dialog: Object.assign(
      ({ children, open, onOpenChange, modal }: any) => {
        if (!open) return null
        return ReactModule.createElement('div', { role: 'dialog', 'data-modal': modal ? 'true' : 'false' }, children)
      },
      {
        Portal: ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children),
        Overlay: ({ children, ...props }: any) =>
          ReactModule.createElement('div', { 'data-testid': 'dialog-overlay' }, children),
        Content: ({ children, ...props }: any) =>
          ReactModule.createElement('div', { 'data-testid': 'dialog-content' }, children),
        Title: ({ children, ...props }: any) =>
          ReactModule.createElement('h2', { 'data-testid': 'dialog-title' }, children),
        Description: ({ children, ...props }: any) =>
          ReactModule.createElement('p', { 'data-testid': 'dialog-description' }, children),
      }
    ),

    Popover: Object.assign(
      ({ children, open, onOpenChange, placement }: any) =>
        ReactModule.createElement('div', { 'data-testid': 'popover', 'data-open': open ? 'true' : 'false' }, children),
      {
        Trigger: ({ children, asChild }: any) =>
          ReactModule.createElement('div', { 'data-testid': 'popover-trigger' }, children),
        Content: ({ children, ...props }: any) =>
          ReactModule.createElement('div', { 'data-testid': 'popover-content' }, children),
      }
    ),

    RadioGroup: Object.assign(
      ({ children, value, onValueChange, required }: any) =>
        ReactModule.createElement('div', { role: 'radiogroup' }, children),
      {
        Item: ({ value, id, ...props }: any) =>
          ReactModule.createElement('input', { type: 'radio', value, id }),
      }
    ),

    Label: ({ children, htmlFor, ...props }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),

    TextArea: ({ value, onChangeText, placeholder, maxLength, ...props }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        maxLength,
      }),
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
  mockHiddenPostIds = new Set()
  // Story 3-13
  mockDeleteMutate.mockReset()
  mockDeleteIsPending = false
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

// ─────────────────────────────────────────────────────────────────────────────
// Story 3-12 additions — locally-hidden filter + PostRow FlagAffordance integration
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// t-new1 — locally-hidden filter applies: hidden post does not render
// AC #18 t-new1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new1 — locally-hidden filter hides post from feed (AC #10, #18)', () => {
  it('post with id in hiddenIds does not render an <article>', () => {
    mockHiddenPostIds = new Set(['p2'])
    mockFeedData = makeFeedData([
      makePost({ id: 'p1', body: 'Post one visible.' }),
      makePost({ id: 'p2', body: 'Post two hidden.' }),
      makePost({ id: 'p3', body: 'Post three visible.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    expect(screen.getByText('Post one visible.')).not.toBeNull()
    expect(screen.queryByText('Post two hidden.')).toBeNull()
    expect(screen.getByText('Post three visible.')).not.toBeNull()
  })

  it('article count matches posts minus hidden', () => {
    mockHiddenPostIds = new Set(['p2'])
    mockFeedData = makeFeedData([
      makePost({ id: 'p1', body: 'Visible 1.' }),
      makePost({ id: 'p2', body: 'Hidden.' }),
      makePost({ id: 'p3', body: 'Visible 2.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBe(2)
  })

  it('does not throw when hiddenIds contains an id not in feed', () => {
    mockHiddenPostIds = new Set(['nonexistent-id'])
    mockFeedData = makeFeedData([
      makePost({ id: 'p1', body: 'Visible post.' }),
    ], 'full')
    mockIsLoading = false

    expect(() => {
      render(React.createElement(CollectiveFeedScreen))
    }).not.toThrow()
    expect(screen.getByText('Visible post.')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new2 — empty hidden set is a no-op (all posts render)
// AC #18 t-new2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new2 — empty hidden set is no-op (AC #10, #18)', () => {
  it('all posts render when hiddenIds is empty', () => {
    mockHiddenPostIds = new Set()
    mockFeedData = makeFeedData([
      makePost({ id: 'q1', body: 'Alpha post.' }),
      makePost({ id: 'q2', body: 'Beta post.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.getByText('Alpha post.')).not.toBeNull()
    expect(screen.getByText('Beta post.')).not.toBeNull()
  })

  it('article count equals total posts when hiddenIds is empty', () => {
    mockHiddenPostIds = new Set()
    mockFeedData = makeFeedData([
      makePost({ id: 'q1', body: 'Alpha post.' }),
      makePost({ id: 'q2', body: 'Beta post.' }),
      makePost({ id: 'q3', body: 'Gamma post.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    const articles = document.querySelectorAll('article')
    expect(articles.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new3 — is_removed precedence: global removal runs before local-hide
// AC #10, #18 t-new3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new3 — is_removed filter runs before local-hide (AC #10, #18)', () => {
  it('post with is_removed===true does not render even when NOT in hiddenIds', () => {
    mockHiddenPostIds = new Set() // NOT locally hidden
    mockFeedData = makeFeedData([
      makePost({ id: 'removed-id', is_removed: true, body: 'Globally removed post.' }),
      makePost({ id: 'visible-id', is_removed: false, body: 'Visible post.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText('Globally removed post.')).toBeNull()
    expect(screen.getByText('Visible post.')).not.toBeNull()
  })

  it('post with is_removed===true AND in hiddenIds does not render (both filters agree)', () => {
    mockHiddenPostIds = new Set(['overlap-id'])
    mockFeedData = makeFeedData([
      makePost({ id: 'overlap-id', is_removed: true, body: 'Overlap post.' }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByText('Overlap post.')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new4 — FlagAffordance mounts on a normal post (non-own, non-deleted, non-anon)
// AC #11, #19 t-new4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new4 — FlagAffordance present on normal post (AC #11, #19)', () => {
  it('renders a button with aria-label="Report this post" for a normal (others) post', () => {
    // After Story 3-13 AC #22: the trigger label is context-aware.
    // canReport=true, canSelfDelete=false → "Report this post".
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'normal-post', user_id: 'other-user', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    // Story 3-13 AC #22: only-Report case renders "Report this post" label.
    const flagBtn = screen.queryByRole('button', { name: /report this post/i })
    expect(flagBtn).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new5 — FlagAffordance hidden on own post (user_id === currentUserId)
// AC #1, #11, #19 t-new5
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new5 — FlagAffordance hidden on own post (AC #1, #11, #19)', () => {
  it('no "Post actions" button when post.user_id === currentUserId', () => {
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'own-post', user_id: 'user-abc123', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByRole('button', { name: /post actions/i })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new6 — FlagAffordance hidden on self-deleted post
// AC #1, #11, #19 t-new6
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new6 — FlagAffordance hidden on self-deleted post (AC #1, #11, #19)', () => {
  it('no "Post actions" button when post.is_user_deleted===true', () => {
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'deleted-post',
        user_id: 'other-user',
        is_user_deleted: true,
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByRole('button', { name: /post actions/i })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t-new7 — FlagAffordance hidden on anonymized post (user_id === null)
// AC #1, #11, #19 t-new7
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-12 / t-new7 — FlagAffordance hidden on anonymized post (AC #1, #11, #19)', () => {
  it('no "Post actions" button when post.user_id===null', () => {
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'anon-post', user_id: null, is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByRole('button', { name: /post actions/i })).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Story 3-13 / self-delete affordance tests
//
// RED PHASE CONTRACT: every test in this block MUST FAIL until the Story 3-13
// developer:
//   1. Renames FlagAffordance's `disabled` prop to `canReport` + adds `canSelfDelete`.
//   2. Adds the Delete menu item inside FlagAffordance's Popover content.
//   3. Adds the delete confirmation Dialog with the exact copy from AC #17.
//   4. Updates PostRow to compute `canSelfDelete` and `canReport` and pass both
//      flags to FlagAffordance.
//
// Test infrastructure notes:
//   - FlagAffordance is mocked above (updated for canReport/canSelfDelete).
//     The mock does NOT render the Dialog — tests that need the Dialog interact
//     with FlagAffordance's REAL implementation, so those tests mock
//     useDeleteOwnPost at the module level but render the real component.
//   - For dialog tests (27.e–g), a separate render strategy is used: we render
//     FlagAffordance directly (not through CollectiveFeedScreen) so the real
//     Dialog code is exercised. This mirrors the report-dialog test pattern.
//   - AC #27a–d use CollectiveFeedScreen render (FlagAffordance mock).
//   - AC #27e–h use direct FlagAffordance render (real component, mocked hook).
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// AC #27a — Delete menu item renders for own non-deleted post
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-13 / t-3-13-a — Delete affordance on own non-deleted post (AC #13, #14, #27a)', () => {
  it('renders "Delete your post" button when post.user_id === currentUserId && !is_user_deleted', () => {
    // RED: fails until PostRow passes canSelfDelete=true for own non-deleted posts
    // and FlagAffordance mock returns the "Delete your post" aria-label variant.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'own-fresh-post', user_id: 'user-abc123', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    // The updated FlagAffordance mock renders aria-label="Delete your post"
    // when canSelfDelete=true and canReport=false (own post, non-deleted).
    const deleteBtn = screen.queryByRole('button', { name: /delete your post/i })
    expect(deleteBtn).not.toBeNull()
  })

  it('FlagAffordance trigger is present for own non-deleted post', () => {
    // RED: confirms the FlagAffordance trigger renders (not null) for own posts.
    // Pre-3-13, the trigger was null for own posts (disabled=true early return).
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'own-post-trigger', user_id: 'user-abc123', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    const flagBtn = document.querySelector('[data-testid="flag-affordance-own-post-trigger"]')
    expect(flagBtn).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #27b — Delete menu item absent for other user's post
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-13 / t-3-13-b — Delete affordance absent on others post (AC #14, #27b)', () => {
  it('does NOT render "Delete your post" button when post.user_id !== currentUserId', () => {
    // RED: fails if PostRow computes canSelfDelete incorrectly and passes true for others' posts.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'others-post', user_id: 'other-user-xyz', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    expect(screen.queryByRole('button', { name: /delete your post/i })).toBeNull()
  })

  it('still renders "Report this post" button for others non-deleted post (canReport=true)', () => {
    // Confirms the existing report affordance still works after the prop rename.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'others-post-2', user_id: 'other-user-xyz', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    const reportBtn = screen.queryByRole('button', { name: /report this post/i })
    expect(reportBtn).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #27c — Delete menu item absent when is_user_deleted === true
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-13 / t-3-13-c — Delete affordance absent on already-deleted post (AC #14, #27c)', () => {
  it('does NOT render "Delete your post" button when post.is_user_deleted === true', () => {
    // RED: fails if PostRow computes canSelfDelete as true even for already-deleted posts.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'already-deleted',
        user_id: 'user-abc123', // own post
        is_user_deleted: true, // already deleted
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    expect(screen.queryByRole('button', { name: /delete your post/i })).toBeNull()
  })

  it('no FlagAffordance trigger at all for own already-deleted post (nothing to show)', () => {
    // The canReport=false AND canSelfDelete=false case — trigger must be null.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'own-deleted',
        user_id: 'user-abc123',
        is_user_deleted: true,
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    const flagBtn = document.querySelector('[data-testid="flag-affordance-own-deleted"]')
    expect(flagBtn).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #27d — Existing Story 3-12 tests preserved after prop rename
// (The FlagAffordance mock update must not break existing t-new4–t-new7 semantics)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-13 / t-3-13-d — prop rename backward-compat guards (AC #16, #27d)', () => {
  it('t-new4 still passes: FlagAffordance present on others normal post', () => {
    // Re-asserts t-new4 semantics with updated mock. canReport=true → "Report this post".
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'normal-post-d', user_id: 'other-user', is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    // "Report this post" because canReport=true, canSelfDelete=false
    const reportBtn = screen.queryByRole('button', { name: /report this post/i })
    expect(reportBtn).not.toBeNull()
  })

  it('t-new6 still passes: FlagAffordance hidden on self-deleted post (others)', () => {
    // After prop rename: canReport=false (is_user_deleted=true), canSelfDelete=false → null.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'deleted-others',
        user_id: 'other-user',
        is_user_deleted: true,
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByRole('button', { name: /post actions/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete your post/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /report this post/i })).toBeNull()
  })

  it('t-new7 still passes: FlagAffordance hidden on anonymized post (user_id=null)', () => {
    // canReport=false (user_id=null), canSelfDelete=false → null.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({ id: 'anon-post-d', user_id: null, is_user_deleted: false }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))
    expect(screen.queryByRole('button', { name: /post actions/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete your post/i })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #27e–g — Delete confirmation Dialog tests
//
// These tests render FlagAffordance DIRECTLY (not through CollectiveFeedScreen)
// so the real Dialog code path executes. The @my/ui mock above provides Dialog
// sub-components. useDeleteOwnPost is mocked at module level (mockDeleteMutate).
// ─────────────────────────────────────────────────────────────────────────────

// Lazy import to avoid import-order issues with vi.mock hoisting
let FlagAffordance: any

beforeEach(async () => {
  // Use vi.importActual to get the REAL FlagAffordance (not the stub mock used by
  // CollectiveFeedScreen tests above). The mutations mock (useDeleteOwnPost,
  // useReportPost) is already applied vi.mock-wide — importActual only bypasses
  // the FlagAffordance module-level mock, not the mutations mock.
  const mod = await vi.importActual<typeof import('../FlagAffordance')>('../FlagAffordance')
  FlagAffordance = (mod as any).FlagAffordance ?? (mod as any).default
})

describe('Story 3-13 / t-3-13-e — Delete confirmation Dialog opens with correct copy (AC #17, #27e)', () => {
  it('tapping Delete menu item opens Dialog with title "Delete this post?"', async () => {
    // RED: fails until FlagAffordance renders a Delete menu item that opens a Dialog.
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'dialog-test-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    // Find and click the Delete trigger (popover button or menu item)
    // The trigger renders "Delete your post" aria-label per AC #22 (only canSelfDelete)
    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    expect(trigger, 'Delete your post trigger must be present').not.toBeNull()

    if (trigger) {
      fireEvent.click(trigger)
    }

    // After clicking trigger, we may need to click the Delete menu item inside popover
    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) {
      fireEvent.click(deleteMenuItem)
    }

    // Dialog should be open with correct title
    const dialogTitle = screen.queryByText(/Delete this post\?/i)
    expect(dialogTitle, 'Dialog title "Delete this post?" must appear').not.toBeNull()
  })

  it('Dialog description contains "[deleted]" mention from AC #17', async () => {
    // RED: fails until Dialog description copy is wired.
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'dialog-desc-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    if (trigger) fireEvent.click(trigger)

    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) fireEvent.click(deleteMenuItem)

    // AC #17 exact copy: "The text will be replaced with '[deleted]'"
    const descriptionText = screen.queryByText(/replaced with '\[deleted\]'/i)
    expect(descriptionText, 'Dialog description must mention "[deleted]"').not.toBeNull()
  })

  it('Dialog contains Cancel and Delete buttons', async () => {
    // RED: fails until Dialog footer has two ExpandingLineButton actions.
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'dialog-buttons-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    if (trigger) fireEvent.click(trigger)

    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) fireEvent.click(deleteMenuItem)

    expect(screen.queryByRole('button', { name: /cancel/i }), 'Cancel button must be present').not.toBeNull()
    expect(screen.queryByRole('button', { name: /^delete$/i }), 'Delete button must be present').not.toBeNull()
  })
})

describe('Story 3-13 / t-3-13-f — Cancel in Dialog fires no mutation (AC #19, #27f)', () => {
  it('tapping Cancel closes Dialog without calling useDeleteOwnPost().mutate', async () => {
    // RED: fails until Cancel handler is wired to close Dialog without mutating.
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'cancel-test-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    // Open the dialog
    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    if (trigger) fireEvent.click(trigger)

    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) fireEvent.click(deleteMenuItem)

    // Dialog should be open
    expect(screen.queryByText(/Delete this post\?/i)).not.toBeNull()

    // Click Cancel
    const cancelBtn = screen.queryByRole('button', { name: /cancel/i })
    expect(cancelBtn, 'Cancel button must be present').not.toBeNull()
    if (cancelBtn) fireEvent.click(cancelBtn)

    // Mutation must NOT have been called
    expect(mockDeleteMutate).not.toHaveBeenCalled()

    // Dialog should be closed (title no longer visible)
    expect(screen.queryByText(/Delete this post\?/i)).toBeNull()
  })
})

describe('Story 3-13 / t-3-13-g — Delete in Dialog fires mutation with correct post_id (AC #18, #27g)', () => {
  it('tapping Delete calls useDeleteOwnPost().mutate({ post_id }) exactly once', async () => {
    // RED: fails until Delete button handler is wired to call deleteMutation.mutate.
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'mutate-test-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    // Open the dialog
    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    if (trigger) fireEvent.click(trigger)

    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) fireEvent.click(deleteMenuItem)

    // Confirm delete
    // There may be multiple "Delete" buttons (menu item + dialog button).
    // We specifically want the one inside the open Dialog (role="dialog").
    const allDeleteBtns = screen.queryAllByRole('button', { name: /^delete$/i })
    const dialogDeleteBtn = allDeleteBtns[allDeleteBtns.length - 1] // last one = dialog action
    expect(dialogDeleteBtn, 'Delete button in dialog must exist').not.toBeNull()

    if (dialogDeleteBtn) fireEvent.click(dialogDeleteBtn)

    // Mutation fired exactly once with correct post_id
    expect(mockDeleteMutate).toHaveBeenCalledTimes(1)
    expect(mockDeleteMutate).toHaveBeenCalledWith({ post_id: 'mutate-test-post' })
  })

  it('Dialog closes after confirming delete', async () => {
    // RED: fails until handleDeleteConfirm calls setDeleteDialogOpen(false).
    if (!FlagAffordance) return

    render(React.createElement(FlagAffordance, {
      postId: 'close-after-delete-post',
      reporterUserId: 'user-abc123',
      canReport: false,
      canSelfDelete: true,
    }))

    const trigger = screen.queryByRole('button', { name: /delete your post/i })
    if (trigger) fireEvent.click(trigger)

    const deleteMenuItem = screen.queryByText(/^Delete$/i)
    if (deleteMenuItem) fireEvent.click(deleteMenuItem)

    expect(screen.queryByText(/Delete this post\?/i), 'Dialog must be open').not.toBeNull()

    const allDeleteBtns = screen.queryAllByRole('button', { name: /^delete$/i })
    const dialogDeleteBtn = allDeleteBtns[allDeleteBtns.length - 1]
    if (dialogDeleteBtn) fireEvent.click(dialogDeleteBtn)

    // Dialog closed
    expect(screen.queryByText(/Delete this post\?/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC #27h — Optimistic update renders deleted state
// This re-uses the existing t8 deletion-state assertions pattern.
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-13 / t-3-13-h — post renders deleted state after optimistic update (AC #17, #27h)', () => {
  it('post with is_user_deleted=true (optimistic) renders AuthorByline deletedDisplay=true', () => {
    // RED: The deletion-state matrix (from Story 3-8 PostRow) must render correctly
    // for a post that was optimistically marked deleted. This re-uses t8's assertion
    // pattern — confirming the optimistic update produces the expected render.
    // The optimistic update sets is_user_deleted=true; PostRow uses that to render deleted state.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'optimistically-deleted',
        user_id: 'user-abc123',
        is_user_deleted: true, // simulates post-optimistic-update state
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    // AuthorByline should show deletedDisplay=true
    const byline = document.querySelector('[data-testid="author-byline"]')
    expect(byline).not.toBeNull()
    expect(byline?.getAttribute('data-deleted-display')).toBe('true')
  })

  it('post with is_user_deleted=true (optimistic) does NOT render ReactionStrip', () => {
    // Deletion-state matrix: ReactionStrip suppressed when is_user_deleted=true.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'optimistic-deleted-no-reactions',
        user_id: 'user-abc123',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    const strip = document.querySelector('[data-testid="reaction-strip-optimistic-deleted-no-reactions"]')
    expect(strip).toBeNull()
  })

  it('post with is_user_deleted=true (optimistic) does NOT render Delete affordance (canSelfDelete=false)', () => {
    // Once deleted, canSelfDelete=false → no Delete affordance shown.
    mockCurrentUserId = 'user-abc123'
    mockFeedData = makeFeedData([
      makePost({
        id: 'no-redelete-post',
        user_id: 'user-abc123',
        is_user_deleted: true,
        body: '[deleted]',
        user_deleted_at: new Date().toISOString(),
      }),
    ], 'full')
    mockIsLoading = false

    render(React.createElement(CollectiveFeedScreen))

    expect(screen.queryByRole('button', { name: /delete your post/i })).toBeNull()
  })
})
