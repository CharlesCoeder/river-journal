// @vitest-environment happy-dom
/**
 * Unit tests for `features/collective/ThreadView.tsx` — title-led redesign.
 *
 * Tests describe user-observable behavior only — no story IDs, AC numbers,
 * epic references, or BMAD labels in identifiers.
 *
 * Architecture under test (post Story 3-16 title-led port):
 *   • The ROOT post is sourced from `useThreadRoot(postId)` (single-row query
 *     returning `{ data, isLoading, error, refetch }` where `data` is ONE object
 *     or `null`/`undefined`). The root is NO LONGER part of `useThread`'s items.
 *   • The reply tree (direct children + lazily-loaded subtrees) is sourced from
 *     `useThread(postId, { role:'root' })` returning the infinite-query shape
 *     `{ data: { pages: [{ items, mode, nextCursor }] } }`. `items` contains
 *     ONLY descendants now (no root row).
 *   • ThreadView renders bodies directly (NOT via PostRow): the root renders an
 *     <h1> title, a byline, the body text, a ReactionStrip (mocked), a reply
 *     affordance, a FlagAffordance (mocked), and a reply-count label. Replies
 *     render the same minus the title, wrapped in a left depth rail
 *     (`data-testid="depth-rail-<id>"`).
 *
 * Coverage map (t1–t26):
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
 *   t23 — deletion-state at root: self-deleted root renders tombstone; children still render
 *   t24 — anonymized root (user_id=null): byline anonymized + body shown; children still render
 *   t25 — telemetry redaction grep: ThreadView.tsx has no console.*+body substring
 *   t26 — error state renders error microcopy and Retry button (calls root query refetch)
 *
 * Mock strategy: vi.mock for useThread + useThreadRoot, useCurrentUserId,
 * useIsSuspended, useLocallyHiddenPostIds, solito/navigation, PostComposer,
 * FlagAffordance, ReactionStrip, CollectiveEligibilityGate, react-native
 * Platform, @my/ui.
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
 * Used both for `useThread` descendant items and as the basis for the
 * `useThreadRoot` root object (which is a single object, not an array).
 */
function buildPost(
  overrides: Partial<{
    id: string
    user_id: string | null
    parent_post_id: string | null
    title: string | null
    body: string
    created_at: string
    is_removed: boolean
    is_user_deleted: boolean
    user_deleted_at: string | null
    descendant_count: number
    reactions: unknown
    mode: 'full' | 'preview'
  }> = {}
) {
  return {
    id: 'post-root',
    user_id: 'user-abc',
    parent_post_id: null,
    title: null,
    body: 'Root post body.',
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    descendant_count: 0,
    reactions: {},
    mode: 'full' as const,
    ...overrides,
  }
}

/**
 * buildRoot — a ThreadRoot-shaped fixture for `useThreadRoot`. The root carries
 * a `title` (h1) and full `body`. Defaults to a non-deleted, full-mode root.
 */
function buildRoot(overrides: Partial<ReturnType<typeof buildPost>> = {}) {
  return buildPost({
    id: 'root',
    parent_post_id: null,
    title: 'Root Title',
    body: 'Root post body.',
    ...overrides,
  })
}

/**
 * buildDeepTree — builds a flat array of DESCENDANT posts forming a chain.
 * The root itself lives in `useThreadRoot`, so index 0 here is the root and the
 * remaining entries are its descendant chain. The caller routes index 0 to the
 * root mock and the rest to the useThread items.
 * root → child → grandchild … all the way down.
 * descendant_count on each ancestor is set to indicate further children exist.
 */
function buildDeepTree(depth: number): ReturnType<typeof buildPost>[] {
  const posts: ReturnType<typeof buildPost>[] = []
  for (let i = 0; i < depth; i++) {
    posts.push(
      buildPost({
        id: `post-depth-${i}`,
        parent_post_id: i === 0 ? null : `post-depth-${i - 1}`,
        body: `Body at depth ${i}`,
        descendant_count: depth - i - 1, // ancestors have children
      })
    )
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

// useThread (reply tree — DESCENDANTS only)
let mockThreadData: any = undefined
let mockThreadIsLoading = false
let mockThreadError: Error | null = null
const mockThreadRefetch = vi.fn()
const mockUseThreadCalls: Array<[string, object]> = []

// useThreadRoot (single root object)
let mockRootData: any = undefined
let mockRootLoading = false
let mockRootError: Error | null = null
const mockRootRefetch = vi.fn()
const mockUseThreadRootCalls: string[] = []

let mockCurrentUserId: string | null = 'user-abc'
let mockIsSuspended: boolean | undefined = false
let mockHiddenPostIds: Set<string> = new Set()

const mockRouterPush = vi.fn()
let mockSearchParams: Record<string, string> = {}

// Platform.OS for the react-native mock below. Mutable so per-suite blocks can
// flip to 'ios' to exercise the mobile depth cap. ThreadView reads Platform.OS
// fresh on every render, so updating this between renders is sufficient.
let mockPlatformOS: 'web' | 'ios' = 'web'

let capturedComposerProps: any[] = []
let capturedFlagAffordanceProps: Map<string, any> = new Map()
let capturedReactionStripProps: Map<string, any> = new Map()

// ─── useThread + useThreadRoot mock ───────────────────────────────────────────
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
  useThreadRoot: (postId: string) => {
    mockUseThreadRootCalls.push(postId)
    return {
      data: mockRootData,
      isLoading: mockRootLoading,
      error: mockRootError,
      refetch: mockRootRefetch,
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

// ─── solito/navigation mock (useRouter + useSearchParams) ─────────────────────
// ThreadView imports both useRouter and useSearchParams from 'solito/navigation'.
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
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
      get OS() {
        return mockPlatformOS
      },
      select: (obj: any) => obj[mockPlatformOS] ?? obj.default,
    },
  }
})

// ─── CollectiveEligibilityGate mock — pass-through wrapper ────────────────────
// The real gate calls useEligibleToPost() → useQuery, which needs a QueryClient
// provider that these tests do not set up. ThreadView tests only care that the
// composer mounts inside the gate; eligibility gating is covered by the gate's
// own tests. Render children directly.
vi.mock('app/features/collective/CollectiveEligibilityGate', () => ({
  CollectiveEligibilityGate: (props: any) => props.children ?? null,
  default: (props: any) => props.children ?? null,
}))

// ─── ReactionStrip mock — captures props for assertions ───────────────────────
// ThreadView calls <ReactionStrip postId userId disabled />. The real component
// pulls useToggleReaction/usePostReactions which need a QueryClient. Render a
// testable stand-in keyed by postId so tombstone-suppression can be asserted.
vi.mock('app/features/collective/ReactionStrip', () => ({
  ReactionStrip: (props: any) => {
    capturedReactionStripProps.set(props.postId, props)
    const React = require('react')
    return React.createElement(
      'div',
      {
        'data-testid': `reaction-strip-${props.postId}`,
        'data-disabled': props.disabled ? 'true' : 'false',
      },
      'reactions'
    )
  },
  default: (props: any) => {
    capturedReactionStripProps.set(props.postId, props)
    const React = require('react')
    return React.createElement(
      'div',
      {
        'data-testid': `reaction-strip-${props.postId}`,
        'data-disabled': props.disabled ? 'true' : 'false',
      },
      'reactions'
    )
  },
}))

// ─── PostComposer mock — captures props for assertions ────────────────────────
vi.mock('app/features/collective/PostComposer', () => ({
  default: (props: any) => {
    capturedComposerProps.push(props)
    const React = require('react')
    return React.createElement(
      'div',
      {
        'data-testid': 'post-composer',
        'data-parent-post-id': props.replyContext?.parentPostId ?? '',
        'data-compact': props.compact ? 'true' : 'false',
      },
      'composer'
    )
  },
  PostComposer: (props: any) => {
    capturedComposerProps.push(props)
    const React = require('react')
    return React.createElement(
      'div',
      {
        'data-testid': 'post-composer',
        'data-parent-post-id': props.replyContext?.parentPostId ?? '',
        'data-compact': props.compact ? 'true' : 'false',
      },
      'composer'
    )
  },
}))

// ─── FlagAffordance mock — captures canFocus and onFocus props ────────────────
vi.mock('app/features/collective/FlagAffordance', () => ({
  default: (props: any) => {
    capturedFlagAffordanceProps.set(props.postId, props)
    const React = require('react')
    return React.createElement(
      'button',
      {
        'data-testid': `flag-affordance-${props.postId}`,
        'data-can-focus': props.canFocus ? 'true' : 'false',
      },
      'flag'
    )
  },
  FlagAffordance: (props: any) => {
    capturedFlagAffordanceProps.set(props.postId, props)
    const React = require('react')
    return React.createElement(
      'button',
      {
        'data-testid': `flag-affordance-${props.postId}`,
        'data-can-focus': props.canFocus ? 'true' : 'false',
      },
      'flag'
    )
  },
}))

// ─── lucide icon mock — ThreadView renders ArrowLeft + CornerUpLeft inline ────
// happy-dom has no SVG renderer for the real icons; stub them as no-op spans so
// the affordances they decorate (back link, reply button) still render.
vi.mock('@tamagui/lucide-icons', () => {
  const React = require('react')
  const Stub = (_props: any) => React.createElement('span', { 'data-icon': true })
  return {
    ArrowLeft: Stub,
    CornerUpLeft: Stub,
  }
})

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
    // The thread eases in via AnimatePresence + enterStyle; in tests we render
    // children straight through so assertions see the content synchronously.
    AnimatePresence: ({ children }: any) => children,

    // Text supports `tag` (e.g. tag="h1" for the root title) so the title-led
    // root renders a real <h1> in the DOM.
    Text: ({ children, tag, ...props }: any) => {
      const htmlTag = tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'span'
      return ReactModule.createElement(htmlTag, mapA11y(props), children)
    },

    View: ({
      children,
      tag,
      onPress,
      accessible,
      accessibilityRole,
      accessibilityLabel,
      role,
      'aria-label': ariaLabel,
      'aria-level': ariaLevel,
      'aria-expanded': ariaExpanded,
      'data-testid': dtid,
      'data-depth': dataDepth,
      ...props
    }: any) => {
      const htmlTag =
        tag === 'ul' ? 'ul' : tag === 'li' ? 'li' : tag === 'article' ? 'article' : 'div'
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

    XStack: ({
      children,
      onPress,
      'aria-label': ariaLabel,
      accessibilityRole,
      role,
      'data-testid': dtid,
      'data-depth': dataDepth,
      ...props
    }: any) => {
      const a11y: Record<string, unknown> = { 'data-stack': 'x' }
      if (onPress) a11y['onClick'] = onPress
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (dtid) a11y['data-testid'] = dtid
      if (dataDepth !== undefined) a11y['data-depth'] = dataDepth
      return ReactModule.createElement('div', a11y, children)
    },

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    ExpandingLineButton: ({ children, onPress, disabled, ...props }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'data-testid':
            props['data-testid'] || `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),

    Separator: () => ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    useReducedMotion: () => false,

    AuthorByline: ({ displayName, deletedDisplay, ...props }: any) =>
      ReactModule.createElement(
        'span',
        {
          'data-testid': 'author-byline',
          'data-deleted-display': deletedDisplay ? 'true' : 'false',
        },
        deletedDisplay ? '[deleted]' : displayName
      ),
  }
})

// ─── Import under test ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import ThreadView from '../ThreadView'

// ─── Local helpers for the title-led DOM ──────────────────────────────────────
// ThreadView no longer renders posts via PostRow / <article>. Each post's
// presence is detected by its DOM footprint:
//   • every non-deleted post renders a FlagAffordance → flag-affordance-<id>
//   • every reply (depth >= 1) is wrapped in a depth rail → depth-rail-<id>
//   • the root renders an <h1> with its title + a reply-count label
// `postPresent` asserts a post id is rendered (via its flag or depth rail).

function flagFor(id: string): HTMLElement | null {
  return screen.queryByTestId(`flag-affordance-${id}`)
}

function railFor(container: HTMLElement, id: string): Element | null {
  return container.querySelector(`[data-testid="depth-rail-${id}"]`)
}

afterEach(() => {
  cleanup()
  mockThreadData = undefined
  mockThreadIsLoading = false
  mockThreadError = null
  mockThreadRefetch.mockReset()
  mockUseThreadCalls.length = 0
  mockRootData = undefined
  mockRootLoading = false
  mockRootError = null
  mockRootRefetch.mockReset()
  mockUseThreadRootCalls.length = 0
  mockCurrentUserId = 'user-abc'
  mockIsSuspended = false
  mockHiddenPostIds = new Set()
  mockRouterPush.mockReset()
  mockSearchParams = {}
  capturedComposerProps = []
  capturedFlagAffordanceProps.clear()
  capturedReactionStripProps.clear()
  mockPlatformOS = 'web'
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — basic root + replies render
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — basic root and replies render', () => {
  it('renders the root (h1 title + body) and two direct-child replies', () => {
    const root = buildRoot({ id: 'root', title: 'Root Title', body: 'Root', descendant_count: 2 })
    const child1 = buildPost({
      id: 'child-1',
      parent_post_id: 'root',
      body: 'Child 1',
      descendant_count: 0,
    })
    const child2 = buildPost({
      id: 'child-2',
      parent_post_id: 'root',
      body: 'Child 2',
      descendant_count: 0,
    })
    mockRootData = root
    mockThreadData = makeThreadData([child1, child2])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // Root renders an <h1> title + its body
    expect(container.querySelector('h1')?.textContent).toBe('Root Title')
    expect(screen.getByText('Root')).toBeTruthy()
    // Root's own flag affordance is present
    expect(flagFor('root')).toBeTruthy()
    // Two replies render (detected by their flag affordances + bodies)
    expect(flagFor('child-1')).toBeTruthy()
    expect(flagFor('child-2')).toBeTruthy()
    expect(screen.getByText('Child 1')).toBeTruthy()
    expect(screen.getByText('Child 2')).toBeTruthy()
  })

  it('mounts useThread with role root AND useThreadRoot for the given postId', () => {
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const rootCall = mockUseThreadCalls.find(
      ([id, opts]: [string, any]) => id === 'root' && (opts as any).role === 'root'
    )
    expect(rootCall).toBeTruthy()
    expect(mockUseThreadRootCalls).toContain('root')
  })

  it('renders the root post at depth 0 (aria-level=1)', () => {
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

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
    const root = buildRoot({ id: 'root', descendant_count: 2 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // The grandchild's rail should carry data-depth="2"
    const depth2Wrapper = container.querySelector('[data-depth="2"]')
    expect(depth2Wrapper).toBeTruthy()
    expect(railFor(container, 'grandchild')?.getAttribute('data-depth')).toBe('2')
  })

  it('depth-1 child wrapper has data-depth="1" (depth rail)', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const depth1Wrapper = container.querySelector('[data-depth="1"]')
    expect(depth1Wrapper).toBeTruthy()
    expect(railFor(container, 'child')?.getAttribute('data-depth')).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — "View N more replies" affordance for collapsed subtrees
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — View N more replies affordance text', () => {
  it('shows "View 5 more replies" below a child with descendant_count=5', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 5 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText('View 5 more replies')).toBeTruthy()
  })

  it('shows "View 1 more reply" (singular) when descendant_count=1', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText('View 1 more reply')).toBeTruthy()
  })

  it('does NOT show "View N more replies" when descendant_count=0', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByText(/View \d+ more repl/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — tapping "View N more replies" mounts expansion useThread
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — tap "View N more replies" mounts expansion useThread', () => {
  it('calls useThread with child id and role=expansion after tap', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 3 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const affordance = screen.getByText('View 3 more replies')
    fireEvent.click(affordance)

    const expansionCall = mockUseThreadCalls.find(
      ([id, opts]: [string, any]) => id === 'child' && (opts as any).role === 'expansion'
    )
    expect(expansionCall).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — "Hide replies" collapses; re-tap re-expands
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — Hide replies / re-expand toggle', () => {
  it('shows "Hide replies" after expanding, then hides children when tapped', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 2 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    // child reports descendant_count=2 but only the grandchild is loaded, so the
    // subtree is not fully loaded → "View N more replies" → tap mounts expansion.
    mockRootData = root
    mockThreadData = makeThreadData([child, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // Expand
    const expandAffordance = screen.getByText('View 2 more replies')
    fireEvent.click(expandAffordance)

    // Should now show "Hide replies"
    const hideAffordance = screen.getByText('Hide replies')
    expect(hideAffordance).toBeTruthy()

    // Collapse
    fireEvent.click(hideAffordance)

    // Grandchild should no longer be rendered
    expect(railFor(container, 'grandchild')).toBeNull()
    expect(flagFor('grandchild')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — depth cap = 6 on web
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — depth cap = 6 on web', () => {
  beforeEach(() => {
    mockPlatformOS = 'web'
  })

  it('shows "Continue this thread →" at depth 6 leaf with descendants', () => {
    // 7 posts: depths 0–6; depth-6 leaf has descendant_count > 0
    const posts = buildDeepTree(7)
    posts[6]!.descendant_count = 3
    mockRootData = posts[0]
    mockThreadData = makeThreadData(posts.slice(1))

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(screen.getByText('Continue this thread →')).toBeTruthy()
  })

  it('does NOT render a 7th-level post inline on web', () => {
    const posts = buildDeepTree(8)
    posts[6]!.descendant_count = 2
    mockRootData = posts[0]
    mockThreadData = makeThreadData(posts.slice(1))

    const { container } = render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    // depth-7 post must not be in DOM
    expect(railFor(container, 'post-depth-7')).toBeNull()
    expect(flagFor('post-depth-7')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — depth cap = 4 on mobile
// ─────────────────────────────────────────────────────────────────────────────

describe('t7 — depth cap = 4 on mobile', () => {
  beforeEach(() => {
    mockPlatformOS = 'ios'
  })

  it('shows "Continue this thread →" at depth 4 leaf on mobile', () => {
    const posts = buildDeepTree(5)
    posts[4]!.descendant_count = 2
    mockRootData = posts[0]
    mockThreadData = makeThreadData(posts.slice(1))

    render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(screen.getByText('Continue this thread →')).toBeTruthy()
  })

  it('does NOT render a 5th-level post inline on mobile', () => {
    const posts = buildDeepTree(6)
    posts[4]!.descendant_count = 1
    mockRootData = posts[0]
    mockThreadData = makeThreadData(posts.slice(1))

    const { container } = render(React.createElement(ThreadView, { postId: 'post-depth-0' }))

    expect(railFor(container, 'post-depth-5')).toBeNull()
    expect(flagFor('post-depth-5')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — "Continue this thread →" routes with focusedFromRoot param
// ─────────────────────────────────────────────────────────────────────────────

describe('t8 — Continue this thread routes with focusedFromRoot', () => {
  it('calls router.push with /collective/thread/<capPostId>?focusedFromRoot=<rootId>', () => {
    const posts = buildDeepTree(7)
    posts[6]!.descendant_count = 1
    mockRootData = posts[0]
    mockThreadData = makeThreadData(posts.slice(1))

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
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByRole('button', { name: /Reply to this/i })).toBeNull()
    expect(screen.queryByText('Reply')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t10 — Reply affordance hidden when suspended
// ─────────────────────────────────────────────────────────────────────────────

describe('t10 — Reply affordance hidden when user is suspended', () => {
  it('renders no Reply button when isSuspended is true', () => {
    mockIsSuspended = true
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByRole('button', { name: /Reply to this/i })).toBeNull()
    expect(screen.queryByText('Reply')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — Reply tap opens inline PostComposer with correct replyContext
// ─────────────────────────────────────────────────────────────────────────────

describe('t11 — Reply tap mounts inline composer with correct replyContext', () => {
  it('mounts PostComposer compact with parentPostId of tapped post', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const replyButtons = screen.getAllByText('Reply')
    expect(replyButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(replyButtons[0]!)

    const composer = screen.getByTestId('post-composer')
    expect(composer).toBeTruthy()
    expect(composer.getAttribute('data-compact')).toBe('true')
    const parentPostId = composer.getAttribute('data-parent-post-id')
    expect(['root', 'child']).toContain(parentPostId)
  })

  it('mounts composer for child post with parentPostId=child when child Reply is tapped', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // The child's reply affordance carries aria-label "Reply to this post"
    const childReplyBtn = screen.getByRole('button', { name: /Reply to this post/i })
    fireEvent.click(childReplyBtn)
    const composer = screen.getByTestId('post-composer')
    expect(composer.getAttribute('data-parent-post-id')).toBe('child')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — only one inline composer at a time
// ─────────────────────────────────────────────────────────────────────────────

describe('t12 — only one composer at a time across the tree', () => {
  it('unmounts the first composer and mounts a new one when Reply is tapped on a different post', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Target the root's reply affordance and the child's reply affordance by their
    // distinct aria-labels.
    const rootReplyBtn = screen.getByRole('button', { name: /Reply to this thread/i })
    const childReplyBtn = screen.getByRole('button', { name: /Reply to this post/i })

    // Open composer for root
    fireEvent.click(rootReplyBtn)
    const firstComposer = screen.getByTestId('post-composer')
    const firstParentId = firstComposer.getAttribute('data-parent-post-id')
    expect(firstParentId).toBe('root')

    // Open composer for child (a different post)
    fireEvent.click(childReplyBtn)

    // Only one composer should be in the DOM
    const composers = screen.getAllByTestId('post-composer')
    expect(composers).toHaveLength(1)

    // The new composer's parentPostId must differ from the first
    const newParentId = composers[0]!.getAttribute('data-parent-post-id')
    expect(newParentId).toBe('child')
    expect(newParentId).not.toBe(firstParentId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — composer onSubmitted unmounts the composer
// ─────────────────────────────────────────────────────────────────────────────

describe('t13 — composer onSubmitted unmounts composer', () => {
  it('removes the composer from DOM when onSubmitted is invoked', () => {
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

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
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

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
// NOTE: a self-deleted node renders a tombstone with NO reply affordance, so a
// reply cannot originate from the withdrawn node itself. An ANONYMIZED parent
// (user_id=null, not self-deleted) still renders its body + reply affordance —
// that is the "deleted parent" a user can still reply to. This test asserts the
// reply path survives on an anonymized root.

describe('t15 — Reply on an anonymized (deleted-author) parent still works', () => {
  it('Reply button is present on an anonymized post and mounts composer', () => {
    const anonRoot = buildRoot({ id: 'root', user_id: null })
    mockRootData = anonRoot
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Reply should still be visible on an anonymized post
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
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const rootFlag = screen.getByTestId('flag-affordance-root')
    expect(rootFlag.getAttribute('data-can-focus')).toBe('false')
  })

  it('child reply FlagAffordance has data-can-focus="true"', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    const childFlag = screen.getByTestId('flag-affordance-child')
    expect(childFlag.getAttribute('data-can-focus')).toBe('true')
  })

  it('captured FlagAffordance props: root canFocus is false', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

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
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

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
    const subroot = buildRoot({ id: 'sub-root' })
    mockRootData = subroot
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'sub-root' }))

    expect(screen.getByText('Back to full thread')).toBeTruthy()
  })

  it('tapping "Back to full thread" routes to the original root thread', () => {
    mockSearchParams = { focusedFromRoot: 'original-root-id' }
    const subroot = buildRoot({ id: 'sub-root' })
    mockRootData = subroot
    mockThreadData = makeThreadData([])

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
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.queryByText('Back to full thread')).toBeNull()
    // The default back affordance is "Back to the room"
    expect(screen.getByText('Back to the room')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t20 — depth-rail tap toggles per-session collapse
// ─────────────────────────────────────────────────────────────────────────────

describe('t20 — depth rail tap toggles per-session collapse', () => {
  it('tapping depth rail hides grandchildren; re-tapping shows them again', () => {
    const root = buildRoot({ id: 'root', descendant_count: 2 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 1 })
    const grandchild = buildPost({ id: 'grandchild', parent_post_id: 'child', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // Grandchild should be in DOM initially
    expect(railFor(container, 'grandchild')).toBeTruthy()
    expect(flagFor('grandchild')).toBeTruthy()

    // Find the depth rail for the child (depth-1 wrapper with onClick)
    const depthRail = railFor(container, 'child')
    expect(depthRail).toBeTruthy()

    // Collapse by tapping the rail
    fireEvent.click(depthRail!)
    expect(railFor(container, 'grandchild')).toBeNull()
    expect(flagFor('grandchild')).toBeNull()

    // Re-expand
    fireEvent.click(depthRail!)
    expect(railFor(container, 'grandchild')).toBeTruthy()
    expect(flagFor('grandchild')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t21 — locally-hidden post and its children filtered from render
// ─────────────────────────────────────────────────────────────────────────────

describe('t21 — locally-hidden post is filtered from render with its descendants', () => {
  it('hidden post is not in DOM', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildRoot({ id: 'root', descendant_count: 2 })
    const hiddenChild = buildPost({
      id: 'hidden-child',
      parent_post_id: 'root',
      descendant_count: 1,
    })
    const grandchild = buildPost({
      id: 'grandchild',
      parent_post_id: 'hidden-child',
      descendant_count: 0,
    })
    mockRootData = root
    mockThreadData = makeThreadData([hiddenChild, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    expect(railFor(container, 'hidden-child')).toBeNull()
    expect(flagFor('hidden-child')).toBeNull()
  })

  it('children of hidden post are also filtered', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildRoot({ id: 'root', descendant_count: 2 })
    const hiddenChild = buildPost({
      id: 'hidden-child',
      parent_post_id: 'root',
      descendant_count: 1,
    })
    const grandchild = buildPost({
      id: 'grandchild',
      parent_post_id: 'hidden-child',
      descendant_count: 0,
    })
    mockRootData = root
    mockThreadData = makeThreadData([hiddenChild, grandchild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    expect(railFor(container, 'grandchild')).toBeNull()
    expect(flagFor('grandchild')).toBeNull()
  })

  it('root post is still rendered when other posts are hidden', () => {
    mockHiddenPostIds = new Set(['hidden-child'])
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const hiddenChild = buildPost({
      id: 'hidden-child',
      parent_post_id: 'root',
      descendant_count: 0,
    })
    mockRootData = root
    mockThreadData = makeThreadData([hiddenChild])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // Root renders its title + flag affordance
    expect(container.querySelector('h1')?.textContent).toBe('Root Title')
    expect(flagFor('root')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t22 — accessibility: ul[role="tree"] + li[role="treeitem"] with aria-level
// ─────────────────────────────────────────────────────────────────────────────

describe('t22 — accessibility tree semantics', () => {
  it('outer container has role="tree"', () => {
    const root = buildRoot({ id: 'root' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const tree = container.querySelector('[role="tree"]')
    expect(tree).toBeTruthy()
  })

  it('each post wrapper has role="treeitem" with aria-level', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = root
    mockThreadData = makeThreadData([child])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    const treeItems = container.querySelectorAll('[role="treeitem"]')
    expect(treeItems.length).toBeGreaterThanOrEqual(2)

    const rootItem = container.querySelector('[role="treeitem"][aria-level="1"]')
    expect(rootItem).toBeTruthy()

    const childItem = container.querySelector('[role="treeitem"][aria-level="2"]')
    expect(childItem).toBeTruthy()
  })

  it('the root body is rendered as a title-led <h1> + body text (no PostRow article)', () => {
    const root = buildRoot({ id: 'root', title: 'My Letter', body: 'The letter body.' })
    mockRootData = root
    mockThreadData = makeThreadData([])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // New DOM: the root renders an <h1> title and its body text.
    expect(container.querySelector('h1')?.textContent).toBe('My Letter')
    expect(screen.getByText('The letter body.')).toBeTruthy()
    // PostRow is gone — there is no <article> for post bodies anymore.
    expect(container.querySelector('article')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t23 — deletion-state at root
// ─────────────────────────────────────────────────────────────────────────────

describe('t23 — deletion-state at root', () => {
  it('a self-deleted root renders the "This letter was withdrawn." tombstone and no reactions', () => {
    const deletedRoot = buildRoot({ id: 'root', is_user_deleted: true, body: 'secret body' })
    mockRootData = deletedRoot
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Tombstone copy is shown; the original body is NOT rendered.
    expect(screen.getByText('This letter was withdrawn.')).toBeTruthy()
    expect(screen.queryByText('secret body')).toBeNull()
    // A withdrawn node renders NO ReactionStrip and NO flag affordance.
    expect(screen.queryByTestId('reaction-strip-root')).toBeNull()
    expect(flagFor('root')).toBeNull()
  })

  it('a self-deleted reply renders the "This reply was withdrawn." tombstone', () => {
    const root = buildRoot({ id: 'root', descendant_count: 1 })
    const deletedChild = buildPost({
      id: 'child',
      parent_post_id: 'root',
      is_user_deleted: true,
      body: 'reply secret',
    })
    mockRootData = root
    mockThreadData = makeThreadData([deletedChild])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText('This reply was withdrawn.')).toBeTruthy()
    expect(screen.queryByText('reply secret')).toBeNull()
    expect(screen.queryByTestId('reaction-strip-child')).toBeNull()
  })

  it('children of a deleted root still render', () => {
    const deletedRoot = buildRoot({ id: 'root', is_user_deleted: true, descendant_count: 1 })
    const child = buildPost({
      id: 'child',
      parent_post_id: 'root',
      body: 'Child body',
      descendant_count: 0,
    })
    mockRootData = deletedRoot
    mockThreadData = makeThreadData([child])

    const { container } = render(React.createElement(ThreadView, { postId: 'root' }))

    // The root is a tombstone, but its descendant reply still renders normally.
    expect(flagFor('child')).toBeTruthy()
    expect(railFor(container, 'child')).toBeTruthy()
    expect(screen.getByText('Child body')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t24 — anonymized root (user_id: null)
// ─────────────────────────────────────────────────────────────────────────────

describe('t24 — anonymized root (user_id null)', () => {
  it('an anonymized root renders its body + a "[deleted]" byline (not a tombstone)', () => {
    const anonRoot = buildRoot({ id: 'root', user_id: null, body: 'anon body' })
    mockRootData = anonRoot
    mockThreadData = makeThreadData([])

    render(React.createElement(ThreadView, { postId: 'root' }))

    // Anonymized (NOT self-deleted): body is still shown, author shows "[deleted]".
    expect(screen.getByText('anon body')).toBeTruthy()
    // The byline renders the anonymized author marker "[deleted]".
    const byline = screen.getByText(/\[deleted\]/)
    expect(byline).toBeTruthy()
    // It is not the tombstone.
    expect(screen.queryByText('This letter was withdrawn.')).toBeNull()
  })

  it('children of anonymized root still render', () => {
    const anonRoot = buildRoot({ id: 'root', user_id: null, descendant_count: 1 })
    const child = buildPost({ id: 'child', parent_post_id: 'root', descendant_count: 0 })
    mockRootData = anonRoot
    mockThreadData = makeThreadData([child])

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(flagFor('child')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t25 — telemetry redaction grep: no console.*body in ThreadView.tsx
// ─────────────────────────────────────────────────────────────────────────────

describe('t25 — telemetry redaction: post body never logged', () => {
  it('ThreadView.tsx does not contain console.log/warn/error with .body content', () => {
    if (!existsSync(THREAD_VIEW_PATH)) {
      throw new Error('ThreadView.tsx does not exist')
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
// Retry now calls the ROOT query's refetch (the root is the body source), not
// useThread's refetch.

describe('t26 — error state renders microcopy and retry', () => {
  it('renders "Couldn\'t load this thread." when useThreadRoot returns an error', () => {
    mockRootError = new Error('Network error')
    mockRootData = undefined
    mockRootLoading = false

    render(React.createElement(ThreadView, { postId: 'root' }))

    expect(screen.getByText(/Couldn't load this thread\./i)).toBeTruthy()
  })

  it('renders a Retry button on error and calls the root query refetch when tapped', () => {
    mockRootError = new Error('Network error')
    mockRootData = undefined
    mockRootLoading = false

    render(React.createElement(ThreadView, { postId: 'root' }))

    const retryBtn = screen.getByText(/Retry/i)
    expect(retryBtn).toBeTruthy()

    fireEvent.click(retryBtn)
    expect(mockRootRefetch).toHaveBeenCalledTimes(1)
    expect(mockThreadRefetch).not.toHaveBeenCalled()
  })
})
