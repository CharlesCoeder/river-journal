// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/moderation/ModerationQueueScreen.tsx`
 * (and, transitively, `ModerationQueueRow.tsx`, which the screen renders).
 *
 * Red-phase contract: every test MUST fail until both target modules exist —
 * the whole file fails at the top-level `import ModerationQueueScreen from
 * '../ModerationQueueScreen'` with a module-resolution error, per this
 * repo's established red-phase convention (see CollectiveFeedScreen.test.tsx
 * / YourPostsScreen.test.tsx).
 *
 * State-ladder contract this file locks in for the implementation
 * (precedence order, mirroring the collective screens' ambient-strip rules):
 *   1. isLoading === true AND data === undefined -> skeleton (5 rows),
 *      gated on isLoading ONLY (never isFetching/isError) so a background
 *      refetch failure can never blank a populated queue.
 *   2. isError === true AND data === undefined -> a bare inline error line,
 *      no list, no skeleton.
 *   3. isError === true AND data !== undefined -> the LAST-GOOD list still
 *      renders, with an ambient error strip alongside it (queue not blanked
 *      by a failed background refetch).
 *   4. data.length === 0 (no blocking error, not loading):
 *        - the last-action query still isLoading -> "No pending flags."
 *          (never flashes a stale/undefined timestamp)
 *        - the last-action query resolved to a timestamp -> "Queue clear."
 *          plus that timestamp
 *        - the last-action query resolved to null -> "No pending flags."
 *   5. populated -> one ModerationQueueRow per item, separated by dividers.
 *   6. root carries data-testid="moderation-queue-screen".
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { timeAgoCasual } from '../../collective/_shared'

const FEATURES_DIR = path.resolve(__dirname, '..')
const SCREEN_PATH = path.join(FEATURES_DIR, 'ModerationQueueScreen.tsx')

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockQueueData: any[] | undefined = undefined
let mockQueueIsLoading = false
let mockQueueIsError = false

let mockLastActionAt: string | null | undefined = null
let mockLastActionIsLoading = false

vi.mock('app/state/collective/moderation', () => ({
  useModerationQueue: () => ({
    data: mockQueueData,
    isLoading: mockQueueIsLoading,
    isError: mockQueueIsError,
  }),
  useLastModerationActionAt: () => ({
    data: mockLastActionAt,
    isLoading: mockLastActionIsLoading,
  }),
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.testID) out['data-testid'] = props.testID
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    if (props.accessibilityRole) out['role'] = props.accessibilityRole
    return out
  }

  return {
    AnimatePresence: ({ children }: any) => children,

    Text: ({ children, tag, ...props }: any) => {
      const htmlTag = typeof tag === 'string' ? tag : 'span'
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
      'data-testid': dataTestId,
      ...props
    }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (dataTestId) a11y['data-testid'] = dataTestId
      if (onPress) a11y['onClick'] = onPress
      return ReactModule.createElement(htmlTag, a11y, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    Separator: (_props: any) => ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until ModerationQueueScreen.tsx exists ────────
// eslint-disable-next-line import/first
import ModerationQueueScreen from '../ModerationQueueScreen'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeQueueItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    post_id: 'post-default',
    author_user_id: 'author-abc12345',
    title: 'A reported letter',
    body: 'The reported body text.',
    post_created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    is_removed: false,
    removed_at: null,
    removed_reason: null,
    is_user_deleted: false,
    user_deleted_at: null,
    flag_count: 1,
    latest_report_reason: 'spam',
    latest_report_note: null,
    latest_report_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    reports: [
      {
        id: 'report-1',
        reason_code: 'spam',
        note: null,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  mockQueueData = undefined
  mockQueueIsLoading = false
  mockQueueIsError = false
  mockLastActionAt = null
  mockLastActionIsLoading = false
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('root testid', () => {
  it('renders the root with data-testid="moderation-queue-screen"', () => {
    mockQueueData = []
    render(<ModerationQueueScreen />)
    expect(document.querySelector('[data-testid="moderation-queue-screen"]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('loading state (isLoading gated, not isFetching/isError)', () => {
  it('renders exactly 5 skeleton rows when isLoading === true and data is undefined', () => {
    mockQueueIsLoading = true
    mockQueueData = undefined
    render(<ModerationQueueScreen />)
    const skeletons = document.querySelectorAll('[data-testid^="skeleton-row"]')
    expect(skeletons.length).toBe(5)
  })

  it('does NOT render any queue row content while the skeleton is showing', () => {
    mockQueueIsLoading = true
    mockQueueData = undefined
    render(<ModerationQueueScreen />)
    expect(document.querySelectorAll('article').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('initial error state (no cached data)', () => {
  it('renders a bare error line when isError === true and data is undefined', () => {
    mockQueueIsError = true
    mockQueueData = undefined
    mockQueueIsLoading = false
    render(<ModerationQueueScreen />)
    expect(screen.getByText(/couldn.t load/i)).not.toBeNull()
  })

  it('does NOT render the skeleton once loading has resolved to an error', () => {
    mockQueueIsError = true
    mockQueueData = undefined
    mockQueueIsLoading = false
    render(<ModerationQueueScreen />)
    expect(document.querySelectorAll('[data-testid^="skeleton-row"]').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('error resilience: a background refetch failure does not blank a populated queue', () => {
  it('renders the last-good list AND an ambient error strip when isError is true but data is populated', () => {
    mockQueueIsError = true
    mockQueueIsLoading = false
    mockQueueData = [makeQueueItem({ post_id: 'still-visible-post', body: 'Still visible body.' })]

    render(<ModerationQueueScreen />)

    // The populated row must still render — the queue is NOT blanked.
    expect(screen.getByText('Still visible body.')).not.toBeNull()
    // An ambient error indicator is present alongside it.
    expect(document.body.textContent).toMatch(/couldn.t refresh|error/i)
  })

  it('does NOT render the skeleton when isError is true but data is populated (isLoading is false)', () => {
    mockQueueIsError = true
    mockQueueIsLoading = false
    mockQueueData = [makeQueueItem()]
    render(<ModerationQueueScreen />)
    expect(document.querySelectorAll('[data-testid^="skeleton-row"]').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('empty state — "Queue clear." vs "No pending flags." precedence', () => {
  it('renders "No pending flags." when the last-action query is still loading (avoids a stale-timestamp flash)', () => {
    mockQueueData = []
    mockQueueIsLoading = false
    mockLastActionIsLoading = true
    mockLastActionAt = undefined

    render(<ModerationQueueScreen />)

    expect(screen.getByText('No pending flags.')).not.toBeNull()
    expect(screen.queryByText(/Queue clear\./)).toBeNull()
  })

  it('renders "Queue clear." with the last-action timestamp when a prior action exists', () => {
    const lastActionIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    mockQueueData = []
    mockQueueIsLoading = false
    mockLastActionIsLoading = false
    mockLastActionAt = lastActionIso

    render(<ModerationQueueScreen />)

    expect(screen.getByText(/Queue clear\./)).not.toBeNull()
    expect(screen.getByText(new RegExp(timeAgoCasual(lastActionIso)))).not.toBeNull()
  })

  it('renders "No pending flags." when there are no moderation actions yet (lastActionAt resolved to null)', () => {
    mockQueueData = []
    mockQueueIsLoading = false
    mockLastActionIsLoading = false
    mockLastActionAt = null

    render(<ModerationQueueScreen />)

    expect(screen.getByText('No pending flags.')).not.toBeNull()
    expect(screen.queryByText(/Queue clear\./)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('populated list', () => {
  it('renders one row per queue item', () => {
    mockQueueData = [
      makeQueueItem({ post_id: 'post-1', body: 'First reported body.' }),
      makeQueueItem({ post_id: 'post-2', body: 'Second reported body.' }),
      makeQueueItem({ post_id: 'post-3', body: 'Third reported body.' }),
    ]
    render(<ModerationQueueScreen />)
    expect(document.querySelectorAll('article').length).toBe(3)
    expect(screen.getByText('First reported body.')).not.toBeNull()
    expect(screen.getByText('Second reported body.')).not.toBeNull()
    expect(screen.getByText('Third reported body.')).not.toBeNull()
  })

  it('separates rows with a 1px divider (Separator)', () => {
    mockQueueData = [
      makeQueueItem({ post_id: 'post-1' }),
      makeQueueItem({ post_id: 'post-2' }),
    ]
    render(<ModerationQueueScreen />)
    expect(document.querySelectorAll('[data-testid="separator"]').length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT render the empty-state copy when the queue is populated', () => {
    mockQueueData = [makeQueueItem()]
    render(<ModerationQueueScreen />)
    expect(screen.queryByText(/Queue clear\./)).toBeNull()
    expect(screen.queryByText('No pending flags.')).toBeNull()
  })

  it('renders a removed post with its "Removed" marker inline in the list', () => {
    mockQueueData = [makeQueueItem({ post_id: 'removed-post', is_removed: true })]
    render(<ModerationQueueScreen />)
    expect(screen.getByText('Removed')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('boundary rule D7 source-grep', () => {
  it('ModerationQueueScreen.tsx exists', () => {
    expect(existsSync(SCREEN_PATH), `ModerationQueueScreen.tsx must exist at ${SCREEN_PATH}`).toBe(true)
  })

  it('ModerationQueueScreen.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('ModerationQueueScreen.tsx does NOT import from app/state/store', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})
