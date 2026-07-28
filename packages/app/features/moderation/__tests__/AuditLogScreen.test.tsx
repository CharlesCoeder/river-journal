// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation/AuditLogScreen.tsx` (and,
 * transitively, `AuditLogRow.tsx`, which the screen renders for real here).
 *
 * Red-phase contract: every test MUST fail until BOTH target modules exist --
 * the whole file fails at the top-level `import AuditLogScreen from
 * '../AuditLogScreen'` with a module-resolution error, mirroring this
 * package's established red-phase convention (see
 * ModerationQueueScreen.test.tsx).
 *
 * State-ladder contract this file locks in for the implementation (mirrors
 * ModerationQueueScreen's precedence order exactly):
 *   1. isLoading === true AND data === undefined -> skeleton (5 rows),
 *      gated on isLoading ONLY (never isFetching/isError).
 *   2. isError === true AND data === undefined -> a bare inline error line,
 *      no list, no skeleton.
 *   3. isError === true AND data !== undefined -> the LAST-GOOD flattened
 *      list still renders, with an ambient error strip alongside it.
 *   4. the flattened list is empty (no blocking error, not loading) ->
 *      "No moderation actions yet."
 *   5. populated -> one row per flattened item, separated by dividers.
 *   6. a "Load more" affordance appears only when hasNextPage is true, calls
 *      fetchNextPage() on press, and is disabled while isFetchingNextPage.
 *   7. root carries a stable test id.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const SCREEN_PATH = path.join(FEATURES_DIR, 'AuditLogScreen.tsx')

// ─── Controlled mock state — useAuditLog() (infinite query shape) ─────────
let mockPages: { items: any[]; nextCursor: string | null }[] | undefined = undefined
let mockIsLoading = false
let mockIsError = false
let mockHasNextPage = false
let mockIsFetchingNextPage = false
const fetchNextPageMock = vi.fn()

// ─── Controlled mock state — the row-level panel hooks (AuditLogRow renders
// for real in this file, so its hook module needs stub coverage too). ─────
const usePostAdminDetailMock = vi.fn((..._args: unknown[]) => ({
  data: null,
  isLoading: false,
  isError: false,
}))
const useTargetModerationHistoryMock = vi.fn((..._args: unknown[]) => ({
  data: [],
  isLoading: false,
  isError: false,
}))

vi.mock('app/state/collective/auditLog', () => ({
  useAuditLog: () => ({
    data: mockPages ? { pages: mockPages, pageParams: mockPages.map(() => null) } : undefined,
    isLoading: mockIsLoading,
    isError: mockIsError,
    hasNextPage: mockHasNextPage,
    isFetchingNextPage: mockIsFetchingNextPage,
    fetchNextPage: fetchNextPageMock,
  }),
  usePostAdminDetail: (...args: unknown[]) => usePostAdminDetailMock(...args),
  useTargetModerationHistory: (...args: unknown[]) => useTargetModerationHistoryMock(...args),
}))

vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => 'me-user-abc12345',
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ───────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.title) out['title'] = props.title
    if (props.testID) out['data-testid'] = props.testID
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    if (props.accessibilityRole) out['role'] = props.accessibilityRole
    if (props['aria-expanded'] !== undefined) out['aria-expanded'] = String(props['aria-expanded'])
    return out
  }

  return {
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
      'aria-expanded': ariaExpanded,
      'data-testid': dataTestId,
      disabled,
      title,
      ...props
    }: any) => {
      const htmlTag = tag === 'article' ? 'article' : tag === 'button' ? 'button' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (ariaExpanded !== undefined) a11y['aria-expanded'] = String(ariaExpanded)
      if (dataTestId) a11y['data-testid'] = dataTestId
      if (title) a11y['title'] = title
      if (disabled !== undefined) a11y['disabled'] = disabled
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

// ─── Import under test — fails until AuditLogScreen.tsx (and AuditLogRow.tsx,
// which it imports) exist ───────────────────────────────────────────────────
// eslint-disable-next-line import/first
import AuditLogScreen from '../AuditLogScreen'

// ─── Fixtures ─────────────────────────────────────────────────────────────
function makeAuditItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'action-default',
    action_type: 'remove_post',
    actor_user_id: 'actor-abc12345',
    target_post_id: 'post-abc12345',
    target_user_id: null,
    reason: 'spam',
    note: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    metadata: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockPages = undefined
  mockIsLoading = false
  mockIsError = false
  mockHasNextPage = false
  mockIsFetchingNextPage = false
  fetchNextPageMock.mockReset()
  usePostAdminDetailMock.mockClear()
  useTargetModerationHistoryMock.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('root testid', () => {
  it('renders the root with a stable audit-log-screen test id', () => {
    mockPages = [{ items: [], nextCursor: null }]
    render(<AuditLogScreen />)
    expect(document.querySelector('[data-testid="audit-log-screen"]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('loading state (isLoading gated, not isFetching/isError)', () => {
  it('renders exactly 5 skeleton rows when isLoading === true and data is undefined', () => {
    mockIsLoading = true
    mockPages = undefined
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('[data-testid^="skeleton-row"]').length).toBe(5)
  })

  it('does NOT render any row content while the skeleton is showing', () => {
    mockIsLoading = true
    mockPages = undefined
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('article').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('initial error state (no cached data)', () => {
  it('renders a bare error line when isError === true and data is undefined', () => {
    mockIsError = true
    mockPages = undefined
    mockIsLoading = false
    render(<AuditLogScreen />)
    expect(document.body.textContent).toMatch(/couldn.t load/i)
  })

  it('does NOT render the skeleton once loading has resolved to an error', () => {
    mockIsError = true
    mockPages = undefined
    mockIsLoading = false
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('[data-testid^="skeleton-row"]').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('error resilience: a background refetch failure keeps the last-good list on screen', () => {
  it('renders the last-good list AND an ambient error strip when isError is true but data is populated', () => {
    mockIsError = true
    mockIsLoading = false
    mockPages = [
      {
        items: [makeAuditItem({ id: 'still-visible', note: 'still visible note' })],
        nextCursor: null,
      },
    ]

    render(<AuditLogScreen />)

    expect(screen.getByText('still visible note')).not.toBeNull()
    expect(document.body.textContent).toMatch(/couldn.t refresh/i)
  })

  it('does NOT render the skeleton when isError is true but data is populated (isLoading is false)', () => {
    mockIsError = true
    mockIsLoading = false
    mockPages = [{ items: [makeAuditItem()], nextCursor: null }]
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('[data-testid^="skeleton-row"]').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('empty state', () => {
  it('renders "No moderation actions yet." when the flattened list is empty', () => {
    mockPages = [{ items: [], nextCursor: null }]
    mockIsLoading = false
    mockIsError = false
    render(<AuditLogScreen />)
    expect(screen.getByText('No moderation actions yet.')).not.toBeNull()
  })

  it('does NOT render the empty-state copy when the list is populated', () => {
    mockPages = [{ items: [makeAuditItem()], nextCursor: null }]
    render(<AuditLogScreen />)
    expect(screen.queryByText('No moderation actions yet.')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('populated list', () => {
  it('renders one row per item, flattened across all loaded pages', () => {
    mockPages = [
      {
        items: [
          makeAuditItem({ id: 'a1', note: 'first note' }),
          makeAuditItem({ id: 'a2', note: 'second note' }),
        ],
        nextCursor: 'cursor-1',
      },
      { items: [makeAuditItem({ id: 'a3', note: 'third note' })], nextCursor: null },
    ]
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('article').length).toBe(3)
    expect(screen.getByText('first note')).not.toBeNull()
    expect(screen.getByText('second note')).not.toBeNull()
    expect(screen.getByText('third note')).not.toBeNull()
  })

  it('separates rows with a 1px divider (Separator)', () => {
    mockPages = [
      { items: [makeAuditItem({ id: 'a1' }), makeAuditItem({ id: 'a2' })], nextCursor: null },
    ]
    render(<AuditLogScreen />)
    expect(document.querySelectorAll('[data-testid="separator"]').length).toBeGreaterThanOrEqual(1)
  })

  it('renders "Charlie"-mapped actor identity as "You" for the current user\'s own actions', () => {
    mockPages = [
      { items: [makeAuditItem({ id: 'a1', actor_user_id: 'me-user-abc12345' })], nextCursor: null },
    ]
    render(<AuditLogScreen />)
    expect(screen.getByText('You')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('"Load more" affordance', () => {
  it('is shown when hasNextPage is true', () => {
    mockPages = [{ items: [makeAuditItem()], nextCursor: 'cursor-1' }]
    mockHasNextPage = true
    render(<AuditLogScreen />)
    expect(document.querySelector('[data-testid="audit-log-load-more"]')).not.toBeNull()
  })

  it('is absent when hasNextPage is false', () => {
    mockPages = [{ items: [makeAuditItem()], nextCursor: null }]
    mockHasNextPage = false
    render(<AuditLogScreen />)
    expect(document.querySelector('[data-testid="audit-log-load-more"]')).toBeNull()
  })

  it('calls fetchNextPage() when pressed', () => {
    mockPages = [{ items: [makeAuditItem()], nextCursor: 'cursor-1' }]
    mockHasNextPage = true
    render(<AuditLogScreen />)
    fireEvent.click(screen.getByTestId('audit-log-load-more'))
    expect(fetchNextPageMock).toHaveBeenCalledTimes(1)
  })

  it('is disabled while isFetchingNextPage is true', () => {
    mockPages = [{ items: [makeAuditItem()], nextCursor: 'cursor-1' }]
    mockHasNextPage = true
    mockIsFetchingNextPage = true
    render(<AuditLogScreen />)
    const btn = screen.getByTestId('audit-log-load-more') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('boundary rule D7 source-grep', () => {
  it('AuditLogScreen.tsx exists', () => {
    expect(existsSync(SCREEN_PATH), `AuditLogScreen.tsx must exist at ${SCREEN_PATH}`).toBe(true)
  })

  it('AuditLogScreen.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('AuditLogScreen.tsx does NOT import from app/state/store', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})
