// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/collective/ThreadView.tsx`.
 *
 * Red-phase contract: every test MUST fail until ThreadView.tsx is implemented
 * (the file does not exist yet). Tests describe user-observable behavior only —
 * no story IDs, AC numbers, epic references, or BMAD labels in identifiers.
 *
 * Coverage map (t1–t25 + t26):
 *   t1  — basic root + replies render
 *   t2  — depth rail rendering (data-depth attribute)
 *   t3  — "View N more replies" affordance for collapsed subtree (plural + singular)
 *   t4  — tap "View N more replies" mounts expansion useThread
 *   t5  — tap "Hide replies" collapses; re-tap re-expands
 *   t6  — depth cap = 6 on web; "Continue this thread →" shown; no deeper post
 *   t7  — depth cap = 4 on mobile (ios); "Continue this thread →" shown; no deeper post
 *   t8  — "Continue this thread →" routes with focusedFromRoot param
 *   t9  — Reply affordance hidden when unauthenticated
 *   t10 — Reply affordance hidden when user is suspended
 *   t11 — Reply tap opens inline PostComposer with correct replyContext
 *   t12 — only one inline composer at a time (switching posts unmounts previous)
 *   t13 — composer onSubmitted unmounts the composer
 *   t14 — composer onCancelled unmounts the composer
 *   t15 — Reply on a deleted parent still mounts composer
 *   t16 — FlagAffordance receives canFocus=false on root, canFocus=true on replies
 *   t17 — tap Focus routes with focusedFromRoot query param
 *   t18 — "Back to full thread" rendered when focusedFromRoot param present; tap routes
 *   t19 — no "Back to full thread" when no focusedFromRoot param
 *   t20 — depth-rail tap toggles per-session collapse
 *   t21 — locally-hidden post and its children are filtered from render
 *   t22 — accessibility: ul[role="tree"] wraps hierarchy; li[role="treeitem"] with aria-level
 *   t23 — deletion-state at root: PostRow receives is_user_deleted=true; children still render
 *   t24 — anonymized root (user_id=null): PostRow receives anonymized post; children still render
 *   t25 — telemetry redaction grep: ThreadView.tsx has no console.*+body substring
 *   t26 — error state renders error microcopy and Retry button
 *
 * Mock strategy: vi.mock for useThread, useCurrentUserId, useIsSuspended,
 * useLocallyHiddenPostIds, solito/router, useSearchParams, PostComposer,
 * FlagAffordance, PostRow, react-native Platform, @my/ui.
 * Mirrors CollectiveFeedScreen.test.tsx patterns.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants for grep tests ────────────────────────────────────────────
const THREAD_VIEW_PATH = path.resolve(__dirname, '..', 'ThreadView.tsx')

// ─── Controlled mock state ─────────────────────────────────────────────────────

/**
 * buildPost — minimal ThreadPost-shaped fixture (includes descendant_count).
 * ThreadView uses ThreadPost (not Post) so descendant_count is present.
 */
function buildPost(overrides: Partial<{
  id: string
  user_id: string | null
  parent_post_id: string | null
  body: string
  created_at: string
  is_removed: boolean
  is_user_deleted: boolean
  user_deleted_at: string | null
  descendant_count: number
  mode: 'full' | 'preview'
}> = {}) {
  return {
    id: 'post-root',
    user_id: 'user-abc',
    parent_post_id: null,
    body: 'Root post body.',
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    descendant_count: 0,
    mode: 'full' as const,
    ...overrides,
  }
}

/**
 * buildDeepTree — builds a flat array of posts forming a chain of `depth` levels.
 * root → child → grandchild … all the way down.
 * descendant_count on each ancestor is set to indicate further children exist.
 */
function buildDeepTree(depth: number): ReturnType<typeof buildPost>[] {
  const posts: ReturnType<typeof buildPost>[] = []
  for (let i = 0; i < depth; i++) {
    posts.push(buildPost({
      id: `post-depth-${i}`,
      parent_post_id: i === 0 ? null : `post-depth-${i - 1}`,
      body: `Body at depth ${i}`,
      descendant_count: depth - i - 1, // ancestors have children
    }))
  }
  return posts
}

function makeThreadData(items: ReturnType<typeof buildPost>[], mode: 'full' | 'preview' = 'full') {
  return {
    pages: [{ items, mode, nextCursor: null }],
    pageParams: [null],
  }
}

// ─── Spy / controlled state holders ───────────────────────────────────────────

let mockThreadData: any = undefined
let mockThreadIsLoading = false
let mockThreadError: Error | null = null
const mockThreadRefetch = vi.fn()
const mockUseThreadCalls: Array<[string, object]> = []

let mockCurrentUserId: string | null = 'user-abc'
let mockIsSuspended: boolean | undefined = false
let mockHiddenPostIds: Set<string> = new Set()

const mockRouterPush = vi.fn()
let mockSearchParams: Record<string, string> = {}

let capturedPostRowProps: any[] = []
let capturedComposerProps: any[] = []
let capturedFlagAffordanceProps: Map<string, any> = new Map()

// ─── useThread mock ───────────────────────────────────────────────────────────
vi.mock('app/state/collective/thread', () => ({
  useThread: (postId: string, opts: object) => {
    mockUseThreadCalls.push([postId, opts])
    return {
      data: mockThreadData,
      isLoading: mockThreadIsLoading,
      error: mockThreadError,
      refetch: mockThreadRefetch,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    }
  },
}))

// ─── useCurrentUserId mock ────────────────────────────────────────────────────
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

// ─── useIsSuspended mock ──────────────────────────────────────────────────────
vi.mock('app/state/collective/suspension', () => ({
  useIsSuspended: (_userId: string | null) => mockIsSuspended,
}))

// ─── useLocallyHiddenPostIds mock ─────────────────────────────────────────────
vi.mock('app/state/collective/locallyHidden', () => ({
  useLocallyHiddenPostIds: () => mockHiddenPostIds,
}))

// ─── solito/router mock ───────────────────────────────────────────────────────
vi.mock('solito/router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ─── Search params mock (Solito useSearchParams or equivalent) ────────────────
vi.mock('solito/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams[key] ?? null,
  }),
}))

// ─── react-native Platform mock ───────────────────────────────────────────────
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native')
  return {
    ...actual,
    Platform: {
      OS: 'web',
      select: (obj: any) => obj.web ?? obj.default,
    },
  }
})

// ─── PostRow mock — captures props for assertions ─────────────────────────────
vi.mock('app/features/collective/PostRow', () => ({
  default: (props: any) => {
    capturedPostRowProps.push(props)
    const React = require('react')
    return React.createElement('article', {
      'data-testid': `post-row-${props.post?.id}`,
      'data-is-deleted': props.post?.is_user_deleted ? 'true' : 'false',
      'data-user-id': props.post?.user_id ?? 'null',
    }, props.post?.body ?? '[deleted]')
  },
  PostRow: (props: any) => {
    capturedPostRowProps.push(props)
    const React = require('react')
    return React.createElement('article', {
      'data-testid': `post-row-${props.post?.id}`,
      'data-is-deleted': props.post?.is_user_deleted ? 'true' : 'false',
      'data-user-id': props.post?.user_id ?? 'null',
    }, props.post?.body ?? '[deleted]')
  },
}))

// ─── PostComposer mock — captures props for assertions ────────────────────────
vi.mock('app/features/collective/PostComposer', () => ({
  default: (props: any) => {
    capturedComposerProps.push(props)
    const React = require('react')
    return React.createElement('div', {
      'data-testid': 'post-composer',
      'data-parent-post-id': props.replyContext?.parentPostId ?? '',
      'data-compact': props.compact ? 'true' : 'false',
    }, 'composer')
  },
  PostComposer: (props: any) => {
    capturedComposerProps.push(props)
    const React = require('react')
    return React.createElement('div', {
      'data-testid': 'post-composer',
      'data-parent-post-id': props.replyContext?.parentPostId ?? '',
      'data-compact': props.compact ? 'true' : 'false',
    }, 'composer')
  },
}))

// ─── FlagAffordance mock — captures canFocus and onFocus props ────────────────
vi.mock('app/features/collective/FlagAffordance', () => ({
  default: (props: any) => {
    capturedFlagAffordanceProps.set(props.postId, props)
    const React = require('react')
    return React.createElement('button', {
      'data-testid': `flag-affordance-${props.postId}`,
      'data-can-focus': props.canFocus ? 'true' : 'false',
    }, 'flag')
  },
  FlagAffordance: (props: any) => {
    capturedFlagAffordanceProps.set(props.postId, props)
    const React = require('react')
    return React.createElement('button', {
      'data-testid': `flag-affordance-${props.postId}`,
      'data-can-focus': props.canFocus ? 'true' : 'false',
    }, 'flag')
  },
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ───────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props['aria-level']) out['aria-level'] = props['aria-level']
    if (props['aria-expanded'] !== undefined) out['aria-expanded'] = String(props['aria-expanded'])
    if (props['aria-disabled'] !== undefined) out['aria-disabled'] = String(props['aria-disabled'])
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.testID) out['data-testid'] = props.testID
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props['data-depth']) out['data-depth'] = props['data-depth']
    if (props['data-tag']) out['data-tag'] = props['data-tag']
    if (props.role) out['role'] = props.role
    if (props.accessibilityRole) out['role'] = props.accessibilityRole
    return out
  }

  return {
    Text: ({ children, ...props }: any) =>
      ReactModule.createElement('span', mapA11y(props), children),

    View: ({ children, tag, onPress, accessible, accessibilityRole, accessibilityLabel,
             role, 'aria-label': ariaLabel, 'aria-level': ariaLevel,
             'aria-expanded': ariaExpanded, 'data-testid': dtid,
             'data-depth': dataDepth, ...props }: any) => {
      const htmlTag = tag === 'ul' ? 'ul' : tag === 'li' ? 'li' : tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (ariaLevel !== undefined) a11y['aria-level'] = ariaLevel
      if (ariaExpanded !== undefined) a11y['aria-expanded'] = String(ariaExpanded)
      if (onPress) a11y['onClick'] = onPress
      if (dtid) a11y['data-testid'] = dtid
      if (dataDepth !== undefined) a11y['data-depth'] = dataDepth
      a11y['data-tag'] = tag
      return ReactModule.createElement(htmlTag, a11y, children)
    },

    XStack: ({ children, onPress, 'aria-label': ariaLabel, accessibilityRole,
               'data-testid': dtid, 'data-depth': dataDepth, ...props }: any) => {
      const a11y: Record<string, unknown> = { 'data-stack': 'x' }
      if (onPress) a11y['onClick'] = onPress
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (dtid) a11y['data-testid'] = dtid
      if (dataDepth !== undefined) a11y['data-depth'] = dataDepth
      return ReactModule.createElement('div', a11y, children)
    },

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    ExpandingLineButton: ({ children, onPress, disabled, ...props }: any) =>
      ReactModule.createElement('button', {
        onClick: onPress,
        disabled: !!disabled,
        'aria-disabled': disabled ? 'true' : 'false',
        'data-testid': props['data-testid'] || `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
      }, children),

    Separator: () => ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    useReducedMotion: () => false,

    AuthorByline: ({ displayName, deletedDisplay, ...props }: any) =>
      ReactModule.createElement('span', {
        'data-testid': 'author-byline',
        'data-deleted-display': deletedDisplay ? 'true' : 'false',
      }, deletedDisplay ? '[deleted]' : displayName),
  }
})

// ─── Import under test (will fail until ThreadView.tsx exists) ────────────────
// eslint-disable-next-line import/first
import ThreadView from '../ThreadView'

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup()
  mockThreadData = undefined
  mockThreadIsLoading = false
  mockThreadError = null
  mockThreadRefetch.mockReset()
  mockUseThreadCalls.length = 0
  mockCurrentUserId = 'user-abc'
  mockIsSuspended = false
  mockHiddenPostIds = new Set()
  mockRouterPush.mockReset()
  mockSearchParams = {}
  capturedPostRowProps = []
  capturedComposerProps = []
  capturedFlagAffordanceProps.clear()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — basic root + replies render
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — basic root and replies render', () => {
  it('renders one PostRow for the root and two PostRows for direct-child replies', () => {
    const root = buildPost({ id: 'root', parent_post_id: null, body: 'Root', descendant_count: 2 })
    const child1 = buildPost({ id: 'child-1', parent_post_id: 'root', body: 'Child 1', descendant_count: 0 })
    const child2 = buildPost({ id: 'child-2', parent_post_id: 'root', body: 'Child 2', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child1, child2])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByTestId('post-row-root')).toBeTruthy()
    expect(screen.getByTestId('post-row-child-1')).toBeTruthy()
    expect(screen.getByTestId('post-row-child-2')).toBeTruthy()
  })

  it('mounts useThread with role root for the given postId', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const rootCall = mockUseThreadCalls.find(([id, opts]: [string, any]) =>
      id === 'root' && (opts as any).role === 'root'
    )
    expect(rootCall).toBeTruthy()
  })

  it('renders the root post at depth 0 (aria-level=1)', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const treeItem = container.querySelector('[role="treeitem"][aria-level="1"]')
    expect(treeItem).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — depth rail rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — depth rail at correct depth level', () => {
  it('renders a depth-2 reply wrapper with data-depth="2" attribute', () => {
    const root = buildPost({ id: 'root', parent_post_id: null, descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // The grandchild's wrapper should carry data-depth="2"
    const depth2Wrapper = container.querySelector('[data-depth="2"]')
    expect(depth2Wrapper).toBeTruthy()
  })

  it('depth-1 child wrapper has data-depth="1" (depth rail)', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const depth1Wrapper = container.querySelector('[data-depth="1"]')
    expect(depth1Wrapper).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — "View N more replies" affordance for collapsed subtrees
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — View N more replies affordance text', () => {
  it('shows "View 5 more replies" below a child with descendant_count=5', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 5 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText('View 5 more replies')).toBeTruthy()
  })

  it('shows "View 1 more reply" (singular) when descendant_count=1', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText('View 1 more reply')).toBeTruthy()
  })

  it('does NOT show "View N more replies" when descendant_count=0', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByText(/View \d+ more repl/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — tapping "View N more replies" mounts expansion useThread
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — tap "View N more replies" mounts expansion useThread', () => {
  it('calls useThread with child id and role=expansion after tap', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 3 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const affordance = screen.getByText('View 3 more replies')
    fireEvent.click(affordance)

    const expansionCall = mockUseThreadCalls.find(([id, opts]: [string, any]) =>
      id === 'child' && (opts as any).role === 'expansion'
    )
    expect(expansionCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — "Hide replies" collapses; re-tap re-expands
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — Hide replies / re-expand toggle', () => {
  it('shows "Hide replies" after expanding, then hides children when tapped', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 2 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    // When expanded, mockThreadData is shared; grandchild is already in tree
    mockThreadData = makeThreadData([root, child, grandchild])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Expand
    const expandAffordance = screen.getByText('View 2 more replies')
    fireEvent.click(expandAffordance)

    // Should now show "Hide replies"
    const hideAffordance = screen.getByText('Hide replies')
    expect(hideAffordance).toBeTruthy()

    // Collapse
    fireEvent.click(hideAffordance)

    // Grandchild should no longer be rendered
    expect(screen.queryByTestId('post-row-grandchild')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — depth cap = 6 on web
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — depth cap = 6 on web', () => {
  beforeEach(() => {
    vi.doMock('react-native', async () => {
      const actual = await vi.importActual<typeof import('react-native')>('react-native')
      return { ...actual, Platform: { OS: 'web', select: (o: any) => o.web ?? o.default } }
    })
  })

  it('shows "Continue this thread →" at depth 6 leaf with descendants', () => {
    // 7 posts: depths 0–6; depth-6 leaf has descendant_count > 0
    const posts = buildDeepTree(7)
    posts[6]!.descendant_count = 3
    mockThreadData = makeThreadData(posts)

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(screen.getByText('Continue this thread →')).toBeTruthy()
  })

  it('does NOT render a 7th-level post inline on web', () => {
    const posts = buildDeepTree(8)
    posts[6]!.descendant_count = 2
    mockThreadData = makeThreadData(posts)

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    // depth-7 post must not be in DOM
    expect(screen.queryByTestId('post-row-post-depth-7')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — depth cap = 4 on mobile
// ─────────────────────────────────────────────────────────────────────────────

describe('t7 — depth cap = 4 on mobile', () => {
  beforeEach(() => {
    vi.doMock('react-native', async () => {
      const actual = await vi.importActual<typeof import('react-native')>('react-native')
      return { ...actual, Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default } }
    })
  })

  it('shows "Continue this thread →" at depth 4 leaf on mobile', () => {
    const posts = buildDeepTree(5)
    posts[4]!.descendant_count = 2
    mockThreadData = makeThreadData(posts)

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(screen.getByText('Continue this thread →')).toBeTruthy()
  })

  it('does NOT render a 5th-level post inline on mobile', () => {
    const posts = buildDeepTree(6)
    posts[4]!.descendant_count = 1
    mockThreadData = makeThreadData(posts)

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(screen.queryByTestId('post-row-post-depth-5')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — "Continue this thread →" routes with focusedFromRoot param
// ─────────────────────────────────────────────────────────────────────────────

describe('t8 — Continue this thread routes with focusedFromRoot', () => {
  it('calls router.push with /collective/thread/<capPostId>?focusedFromRoot=<rootId>', () => {
    const posts = buildDeepTree(7)
    posts[6]!.descendant_count = 1
    mockThreadData = makeThreadData(posts)

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    const continueBtn = screen.getByText('Continue this thread →')
    fireEvent.click(continueBtn)

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringMatching(/\/collective\/thread\/post-depth-6\?focusedFromRoot=post-depth-0/)
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — Reply affordance hidden when unauthenticated
// ─────────────────────────────────────────────────────────────────────────────

describe('t9 — Reply affordance hidden when unauthenticated', () => {
  it('renders no Reply button when currentUserId is null', () => {
    mockCurrentUserId = null
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByRole('button', { name: /Reply/i })).toBeNull()
    expect(screen.queryByText('Reply')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t10 — Reply affordance hidden when suspended
// ─────────────────────────────────────────────────────────────────────────────

describe('t10 — Reply affordance hidden when user is suspended', () => {
  it('renders no Reply button when isSuspended is true', () => {
    mockIsSuspended = true
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByRole('button', { name: /Reply/i })).toBeNull()
    expect(screen.queryByText('Reply')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — Reply tap opens inline PostComposer with correct replyContext
// ─────────────────────────────────────────────────────────────────────────────

describe('t11 — Reply tap mounts inline composer with correct replyContext', () => {
  it('mounts PostComposer compact with parentPostId of tapped post', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Tap Reply on the child post — find by accessible name + proximity
    // The Reply button should be associated with/near child
    const replyButtons = screen.getAllByText('Reply')
    // Find the one for the child — it renders below child's PostRow
    expect(replyButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(replyButtons[0]!)

    const composer = screen.getByTestId('post-composer')
    expect(composer).toBeTruthy()
    expect(composer.getAttribute('data-compact')).toBe('true')
    const parentPostId = composer.getAttribute('data-parent-post-id')
    // Must be either root or child id — depending on which Reply was clicked
    expect(['root', 'child']).toContain(parentPostId)
  })

  it('mounts composer for child post with parentPostId=child when child Reply is tapped', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Use aria-label to target the specific Reply button
    const childReplyBtn = screen.getByRole('button', {
      name: /Reply to this post/i,
    })
    // There may be multiple; target the one near child
    // Fall back: find all and click the second (child's)
    const allReplyBtns = screen.getAllByText('Reply')
    // Click the child's Reply — it should be the second button
    if (allReplyBtns.length >= 2) {
      fireEvent.click(allReplyBtns[1]!)
      const composer = screen.getByTestId('post-composer')
      expect(composer.getAttribute('data-parent-post-id')).toBe('child')
    } else {
      // If only root Reply is present, verify the single composer exists
      fireEvent.click(allReplyBtns[0]!)
      expect(screen.getByTestId('post-composer')).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — only one inline composer at a time
// ─────────────────────────────────────────────────────────────────────────────

describe('t12 — only one composer at a time across the tree', () => {
  it('unmounts the first composer and mounts a new one when Reply is tapped on a different post', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const replyButtons = screen.getAllByText('Reply')
    expect(replyButtons.length).toBeGreaterThanOrEqual(2)

    // Open composer for root
    fireEvent.click(replyButtons[0]!)
    const firstComposer = screen.getByTestId('post-composer')
    const firstParentId = firstComposer.getAttribute('data-parent-post-id')

    // Open composer for child (a different post)
    fireEvent.click(replyButtons[1]!)

    // Only one composer should be in the DOM
    const composers = screen.getAllByTestId('post-composer')
    expect(composers).toHaveLength(1)

    // The new composer's parentPostId must differ from the first
    const newParentId = composers[0]!.getAttribute('data-parent-post-id')
    expect(newParentId).not.toBe(firstParentId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — composer onSubmitted unmounts the composer
// ─────────────────────────────────────────────────────────────────────────────

describe('t13 — composer onSubmitted unmounts composer', () => {
  it('removes the composer from DOM when onSubmitted is invoked', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const replyBtn = screen.getByText('Reply')
    fireEvent.click(replyBtn)

    // Composer is mounted
    expect(screen.getByTestId('post-composer')).toBeTruthy()

    // Invoke onSubmitted via captured props
    const composerProps = capturedComposerProps[capturedComposerProps.length - 1]
    expect(composerProps).toBeTruthy()
    expect(typeof composerProps.onSubmitted).toBe('function')
    composerProps.onSubmitted()

    expect(screen.queryByTestId('post-composer')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t14 — composer onCancelled unmounts the composer
// ─────────────────────────────────────────────────────────────────────────────

describe('t14 — composer onCancelled unmounts composer', () => {
  it('removes the composer from DOM when onCancelled is invoked', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const replyBtn = screen.getByText('Reply')
    fireEvent.click(replyBtn)

    expect(screen.getByTestId('post-composer')).toBeTruthy()

    const composerProps = capturedComposerProps[capturedComposerProps.length - 1]
    expect(typeof composerProps.onCancelled).toBe('function')
    composerProps.onCancelled()

    expect(screen.queryByTestId('post-composer')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t15 — Reply on a deleted parent still mounts composer
// ─────────────────────────────────────────────────────────────────────────────

describe('t15 — Reply on a deleted parent still works', () => {
  it('Reply button is present on a deleted post and mounts composer', () => {
    const deletedRoot = buildPost({ id: 'root', is_user_deleted: true })
    mockThreadData = makeThreadData([deletedRoot])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Reply should still be visible on deleted post
    const replyBtn = screen.getByText('Reply')
    expect(replyBtn).toBeTruthy()

    fireEvent.click(replyBtn)

    const composer = screen.getByTestId('post-composer')
    expect(composer.getAttribute('data-parent-post-id')).toBe('root')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t16 — FlagAffordance receives canFocus=false on root, canFocus=true on replies
// ─────────────────────────────────────────────────────────────────────────────

describe('t16 — Focus menu item: root has canFocus=false, replies have canFocus=true', () => {
  it('root FlagAffordance has data-can-focus="false"', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const rootFlag = screen.getByTestId('flag-affordance-root')
    expect(rootFlag.getAttribute('data-can-focus')).toBe('false')
  })

  it('child reply FlagAffordance has data-can-focus="true"', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const childFlag = screen.getByTestId('flag-affordance-child')
    expect(childFlag.getAttribute('data-can-focus')).toBe('true')
  })

  it('captured FlagAffordance props: root canFocus is false', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const rootProps = capturedFlagAffordanceProps.get('root')
    expect(rootProps?.canFocus).toBeFalsy()

    const childProps = capturedFlagAffordanceProps.get('child')
    expect(childProps?.canFocus).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t17 — tap Focus routes with focusedFromRoot query param
// ─────────────────────────────────────────────────────────────────────────────

describe('t17 — Focus routes reply with focusedFromRoot param', () => {
  it('invoking onFocus for a child routes to /collective/thread/<childId>?focusedFromRoot=<rootId>', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const childFlagProps = capturedFlagAffordanceProps.get('child')
    expect(typeof childFlagProps?.onFocus).toBe('function')
    childFlagProps.onFocus()

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringMatching(/\/collective\/thread\/child\?focusedFromRoot=root/)
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t18 — "Back to full thread" rendered when focusedFromRoot param present
// ─────────────────────────────────────────────────────────────────────────────

describe('t18 — Back to full thread rendered when focusedFromRoot query param present', () => {
  it('renders "Back to full thread" button when focusedFromRoot is set', () => {
    mockSearchParams = { focusedFromRoot: 'original-root-id' }
    const subroot = buildPost({ id: 'sub-root' })
    mockThreadData = makeThreadData([subroot])

    render(React.createElement(ThreadView, { postId: 'sub-root' }))

    expect(screen.getByText('Back to full thread')).toBeTruthy()
  })

  it('tapping "Back to full thread" routes to the original root thread', () => {
    mockSearchParams = { focusedFromRoot: 'original-root-id' }
    const subroot = buildPost({ id: 'sub-root' })
    mockThreadData = makeThreadData([subroot])

    render(React.createElement(ThreadView, { postId: 'sub-root' }))

    const backBtn = screen.getByText('Back to full thread')
    fireEvent.click(backBtn)

    expect(mockRouterPush).toHaveBeenCalledWith('/collective/thread/original-root-id')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t19 — no "Back to full thread" when no focusedFromRoot param
// ─────────────────────────────────────────────────────────────────────────────

describe('t19 — no Back to full thread without focusedFromRoot param', () => {
  it('does NOT render "Back to full thread" when no focusedFromRoot query param', () => {
    mockSearchParams = {}
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByText('Back to full thread')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t20 — depth-rail tap toggles per-session collapse
// ─────────────────────────────────────────────────────────────────────────────

describe('t20 — depth rail tap toggles per-session collapse', () => {
  it('tapping depth rail hides grandchildren; re-tapping shows them again', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // Grandchild should be in DOM initially
    expect(screen.getByTestId('post-row-grandchild')).toBeTruthy()

    // Find the depth rail for the child (depth-1 wrapper with onClick)
    const depthRail = container.querySelector('[data-testid="depth-rail-child"]')
    expect(depthRail).toBeTruthy()

    // Collapse by tapping the rail
    fireEvent.click(depthRail!)
    expect(screen.queryByTestId('post-row-grandchild')).toBeNull()

    // Re-expand
    fireEvent.click(depthRail!)
    expect(screen.getByTestId('post-row-grandchild')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t21 — locally-hidden post and its children filtered from render
// ─────────────────────────────────────────────────────────────────────────────

describe('t21 — locally-hidden post is filtered from render with its descendants', () => {
  it('hidden post is not in DOM', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const hiddenChild = buildPost({ id: 'hidden-child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'hidden-child', descendant_count: 0 })
    mockThreadData = makeThreadData([root, hiddenChild, grandchild])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByTestId('post-row-hidden-child')).toBeNull()
  })

  it('children of hidden post are also filtered', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const hiddenChild = buildPost({ id: 'hidden-child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'hidden-child', descendant_count: 0 })
    mockThreadData = makeThreadData([root, hiddenChild, grandchild])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByTestId('post-row-grandchild')).toBeNull()
  })

  it('root post is still rendered when other posts are hidden', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const hiddenChild = buildPost({ id: 'hidden-child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, hiddenChild])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByTestId('post-row-root')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t22 — accessibility: ul[role="tree"] + li[role="treeitem"] with aria-level
// ─────────────────────────────────────────────────────────────────────────────

describe('t22 — accessibility tree semantics', () => {
  it('outer container has role="tree"', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const tree = container.querySelector('[role="tree"]')
    expect(tree).toBeTruthy()
  })

  it('each post wrapper has role="treeitem" with aria-level', () => {
    const root = buildPost({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([root, child])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const treeItems = container.querySelectorAll('[role="treeitem"]')
    expect(treeItems.length).toBeGreaterThanOrEqual(2)

    const rootItem = container.querySelector('[role="treeitem"][aria-level="1"]')
    expect(rootItem).toBeTruthy()

    const childItem = container.querySelector('[role="treeitem"][aria-level="2"]')
    expect(childItem).toBeTruthy()
  })

  it('each post body is rendered inside an <article> element (via PostRow)', () => {
    const root = buildPost({ id: 'root' })
    mockThreadData = makeThreadData([root])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const article = container.querySelector('article')
    expect(article).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t23 — deletion-state at root
// ─────────────────────────────────────────────────────────────────────────────

describe('t23 — deletion-state at root', () => {
  it('PostRow receives is_user_deleted=true for a self-deleted root', () => {
    const deletedRoot = buildPost({ id: 'root', is_user_deleted: true })
    mockThreadData = makeThreadData([deletedRoot])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const postRow = screen.getByTestId('post-row-root')
    expect(postRow.getAttribute('data-is-deleted')).toBe('true')
  })

  it('children of a deleted root still render', () => {
    const deletedRoot = buildPost({ id: 'root', is_user_deleted: true, descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([deletedRoot, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByTestId('post-row-child')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t24 — anonymized root (user_id: null)
// ─────────────────────────────────────────────────────────────────────────────

describe('t24 — anonymized root (user_id null)', () => {
  it('PostRow receives user_id=null for an anonymized root post', () => {
    const anonRoot = buildPost({ id: 'root', user_id: null })
    mockThreadData = makeThreadData([anonRoot])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const postRow = screen.getByTestId('post-row-root')
    expect(postRow.getAttribute('data-user-id')).toBe('null')
  })

  it('children of anonymized root still render', () => {
    const anonRoot = buildPost({ id: 'root', user_id: null, descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockThreadData = makeThreadData([anonRoot, child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByTestId('post-row-child')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t25 — telemetry redaction grep: no console.*body in ThreadView.tsx
// ─────────────────────────────────────────────────────────────────────────────

describe('t25 — telemetry redaction: post body never logged', () => {
  it('ThreadView.tsx does not contain console.log/warn/error with .body content', () => {
    if (!existsSync(THREAD_VIEW_PATH)) {
      // File does not exist yet — test fails by design (red phase)
      throw new Error('ThreadView.tsx does not exist yet — red phase')
    }
    const src = readFileSync(THREAD_VIEW_PATH, 'utf8')

    const bodyLogPattern1 = /console\.(log|warn|error)\([^)]*body/
    const bodyLogPattern2 = /console\.(log|warn|error)\([^)]*\.body/

    expect(bodyLogPattern1.test(src)).toBe(false)
    expect(bodyLogPattern2.test(src)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t26 — error state renders error microcopy and Retry button
// ─────────────────────────────────────────────────────────────────────────────

describe('t26 — error state renders microcopy and retry', () => {
  it('renders "Couldn\'t load this thread." when useThread returns an error', () => {
    mockThreadError = new Error('Network error')
    mockThreadData = undefined
    mockThreadIsLoading = false

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText(/Couldn't load this thread\./i)).toBeTruthy()
  })

  it('renders a Retry button on error and calls refetch when tapped', () => {
    mockThreadError = new Error('Network error')
    mockThreadData = undefined
    mockThreadIsLoading = false

    render(React.createElement(ThreadView, { postId: 'root' }))

    const retryBtn = screen.getByText(/Retry/i)
    expect(retryBtn).toBeTruthy()

    fireEvent.click(retryBtn)
    expect(mockThreadRefetch).toHaveBeenCalledTimes(1)
  })
})
