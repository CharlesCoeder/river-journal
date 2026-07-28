// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation/AuditLogRow.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists --
 * the whole file fails at the top-level `import AuditLogRow from
 * '../AuditLogRow'` with a module-resolution error, mirroring this package's
 * established red-phase convention (see ModerationQueueRow.test.tsx).
 *
 * Contract this file locks in for the implementation:
 *   - Props: `{ item: AuditLogItem; currentUserId: string | null | undefined }`.
 *   - Action-type label mapping (with a raw-code fallback for anything
 *     unrecognized -- the column is a free TEXT check today).
 *   - Actor: an 8-char slice of `actor_user_id`, mapped to "You" when it
 *     equals `currentUserId`, and "[deleted moderator]" when null.
 *   - Target linkout: an 8-char slice of whichever of `target_post_id` /
 *     `target_user_id` is set; a neutral placeholder (never a crash) when
 *     BOTH are null, and no expand toggle offered on that row.
 *   - reason/note rendered when non-null; note omitted (no stray line) when
 *     null.
 *   - Timestamp: a relative label, with the exact ISO instant preserved on
 *     the element (title or aria-label) so a relative label never hides the
 *     precise moment an action occurred.
 *   - A dedicated expand toggle (button semantics + aria-expanded) opens an
 *     inline panel driving the post-detail + target-history hooks with the
 *     correct arguments; a user-only row's panel shows history with no post
 *     block; a zero-row post-detail renders a calm "no longer available"
 *     note; the tapped row's own action is present in its rendered history.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { timeAgoCasual } from '../../collective/_shared'

const FEATURES_DIR = path.resolve(__dirname, '..')
const ROW_PATH = path.join(FEATURES_DIR, 'AuditLogRow.tsx')

// ─── Controlled mock state for the panel hooks ─────────────────────────────
let mockPostDetailData: any = null
let mockPostDetailIsLoading = false
let mockPostDetailIsError = false

let mockHistoryData: any[] | undefined = []
let mockHistoryIsLoading = false
let mockHistoryIsError = false

const usePostAdminDetailMock = vi.fn((..._args: unknown[]) => ({
  data: mockPostDetailData,
  isLoading: mockPostDetailIsLoading,
  isError: mockPostDetailIsError,
}))
const useTargetModerationHistoryMock = vi.fn((..._args: unknown[]) => ({
  data: mockHistoryData,
  isLoading: mockHistoryIsLoading,
  isError: mockHistoryIsError,
}))

vi.mock('app/state/collective/auditLog', () => ({
  usePostAdminDetail: (...args: unknown[]) => usePostAdminDetailMock(...args),
  useTargetModerationHistory: (...args: unknown[]) => useTargetModerationHistoryMock(...args),
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

// ─── Import under test — fails until AuditLogRow.tsx exists ─────────────────
// eslint-disable-next-line import/first
import AuditLogRow from '../AuditLogRow'

// ─── Fixtures ─────────────────────────────────────────────────────────────
function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
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
  mockPostDetailData = null
  mockPostDetailIsLoading = false
  mockPostDetailIsError = false
  mockHistoryData = []
  mockHistoryIsLoading = false
  mockHistoryIsError = false
  usePostAdminDetailMock.mockClear()
  useTargetModerationHistoryMock.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('action-type label mapping', () => {
  it('maps remove_post to "Removed post"', () => {
    render(
      <AuditLogRow
        item={makeItem({ action_type: 'remove_post' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('Removed post')).not.toBeNull()
  })

  it('maps suspend_user to "Suspended user"', () => {
    render(
      <AuditLogRow
        item={makeItem({
          action_type: 'suspend_user',
          target_post_id: null,
          target_user_id: 'user-abc12345',
        })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('Suspended user')).not.toBeNull()
  })

  it('maps add_note to "Added note"', () => {
    render(
      <AuditLogRow
        item={makeItem({ action_type: 'add_note' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('Added note')).not.toBeNull()
  })

  it('maps reinstate to "Reinstated post"', () => {
    render(
      <AuditLogRow
        item={makeItem({ action_type: 'reinstate' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('Reinstated post')).not.toBeNull()
  })

  it('falls back to the raw code for an unrecognized action_type', () => {
    render(
      <AuditLogRow
        item={makeItem({ action_type: 'future_action_code' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('future_action_code')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('actor display', () => {
  it('renders the first 8 characters of actor_user_id when it does not match currentUserId', () => {
    render(
      <AuditLogRow
        item={makeItem({ actor_user_id: 'zzzzzzzz9999' })}
        currentUserId="someone-else"
      />
    )
    expect(screen.getByText(/zzzzzzzz/)).not.toBeNull()
  })

  it('renders "You" when actor_user_id equals currentUserId', () => {
    render(
      <AuditLogRow
        item={makeItem({ actor_user_id: 'me-abc12345' })}
        currentUserId="me-abc12345"
      />
    )
    expect(screen.getByText('You')).not.toBeNull()
  })

  it('renders "[deleted moderator]" when actor_user_id is null, and never crashes', () => {
    expect(() =>
      render(
        <AuditLogRow
          item={makeItem({ actor_user_id: null })}
          currentUserId="anyone"
        />
      )
    ).not.toThrow()
    expect(screen.getByText('[deleted moderator]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('target linkout label', () => {
  it('renders the first 8 characters of target_post_id when present', () => {
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'postxyz12345', target_user_id: null })}
        currentUserId={null}
      />
    )
    expect(screen.getByText(/postxyz1/)).not.toBeNull()
  })

  it('falls back to the first 8 characters of target_user_id when target_post_id is null (suspend_user)', () => {
    render(
      <AuditLogRow
        item={makeItem({
          action_type: 'suspend_user',
          target_post_id: null,
          target_user_id: 'useruvw12345',
        })}
        currentUserId={null}
      />
    )
    expect(screen.getByText(/useruvw1/)).not.toBeNull()
  })

  it('renders a neutral "—" placeholder, offers NO expand toggle, and never crashes when BOTH targets are null', () => {
    expect(() =>
      render(
        <AuditLogRow
          item={makeItem({
            action_type: 'add_note',
            target_post_id: null,
            target_user_id: null,
            reason: null,
            note: 'a freestanding operator note',
          })}
          currentUserId={null}
        />
      )
    ).not.toThrow()
    expect(screen.getByText('—')).not.toBeNull()
    expect(document.querySelector('[data-testid="audit-row-expand-toggle"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('reason + note rendering', () => {
  it('renders the reason when non-null', () => {
    render(
      <AuditLogRow
        item={makeItem({ reason: 'harassment' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText(/harassment/)).not.toBeNull()
  })

  it('renders the note when non-null', () => {
    render(
      <AuditLogRow
        item={makeItem({ note: 'left a note for the record' })}
        currentUserId={null}
      />
    )
    expect(screen.getByText('left a note for the record')).not.toBeNull()
  })

  it('omits the note line entirely when note is null', () => {
    render(
      <AuditLogRow
        item={makeItem({ note: null })}
        currentUserId={null}
      />
    )
    expect(screen.queryByText(/^note:/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('timestamp — relative label with the exact instant preserved', () => {
  it('renders the relative time label produced by timeAgoCasual', () => {
    const createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    render(
      <AuditLogRow
        item={makeItem({ created_at: createdAt })}
        currentUserId={null}
      />
    )
    expect(screen.getByText(timeAgoCasual(createdAt))).not.toBeNull()
  })

  it('preserves the exact absolute ISO instant on the timestamp element (title or aria-label), never only the relative label', () => {
    const createdAt = '2026-07-01T08:15:30.000Z'
    render(
      <AuditLogRow
        item={makeItem({ created_at: createdAt })}
        currentUserId={null}
      />
    )
    const el = document.querySelector('[data-testid="audit-row-timestamp"]')
    expect(el).not.toBeNull()
    const preserved = el?.getAttribute('title') ?? el?.getAttribute('aria-label')
    expect(preserved).toContain(createdAt)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('expand toggle + inline panel — post-referencing row', () => {
  it('is collapsed by default: aria-expanded="false" and no panel content', () => {
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    const toggle = screen.getByTestId('audit-row-expand-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-testid="audit-row-panel"]')).toBeNull()
  })

  it('clicking the toggle sets aria-expanded="true" and opens the panel', () => {
    mockPostDetailData = {
      post_id: 'post-abc12345',
      title: 'A post',
      body: 'Body text',
      is_removed: false,
      is_user_deleted: false,
      author_user_id: 'author-abc12345',
    }
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )

    const toggle = screen.getByTestId('audit-row-expand-toggle')
    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-testid="audit-row-panel"]')).not.toBeNull()
  })

  it('expanding a post-referencing row enables the post-detail hook with the target_post_id', () => {
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    const lastCall = usePostAdminDetailMock.mock.calls.at(-1)!
    expect(lastCall[0]).toBe('post-abc12345')
    expect(lastCall[1]).toBe(true)
  })

  it('expanding a post-referencing row enables the target-history hook keyed by target_post_id', () => {
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345', target_user_id: null })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    const lastCall = useTargetModerationHistoryMock.mock.calls.at(-1)!
    expect(lastCall[0]).toMatchObject({ targetPostId: 'post-abc12345', enabled: true })
  })

  it('the post-detail hook is NOT enabled before the row is expanded', () => {
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    const lastCall = usePostAdminDetailMock.mock.calls.at(-1)!
    expect(lastCall[1]).toBe(false)
  })

  it('renders "Post no longer available." when the post-detail hook resolves to zero rows (data: null) while expanded', () => {
    mockPostDetailData = null
    mockPostDetailIsLoading = false
    mockPostDetailIsError = false
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    expect(screen.getByText('Post no longer available.')).not.toBeNull()
  })

  it('renders a calm inline loading indicator while the panel data is loading', () => {
    mockPostDetailIsLoading = true
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    expect(document.body.textContent).toMatch(/loading/i)
  })

  it('renders a calm inline error line (never a raw error/stack trace) when the panel data errors', () => {
    mockPostDetailIsError = true
    render(
      <AuditLogRow
        item={makeItem({ target_post_id: 'post-abc12345' })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    expect(document.body.textContent).toMatch(/couldn.t|unavailable|error/i)
    expect(document.body.textContent).not.toMatch(/42501|SQLSTATE|at Object\.|\.ts:\d+/)
  })

  it("the tapped row's own action appears in its rendered history list (not filtered out)", () => {
    const tapped = makeItem({
      id: 'tapped-action-id',
      target_post_id: 'post-abc12345',
      note: 'the tapped note',
    })
    mockHistoryData = [
      tapped,
      makeItem({
        id: 'earlier-action-id',
        target_post_id: 'post-abc12345',
        note: 'an earlier note',
      }),
    ]
    render(
      <AuditLogRow
        item={tapped}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    const panel = document.querySelector('[data-testid="audit-row-panel"]')
    expect(panel?.textContent).toContain('the tapped note')
    expect(panel?.textContent).toContain('an earlier note')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('expand toggle + inline panel — user-only row (suspend_user)', () => {
  it('offers an expand toggle even without a target_post_id', () => {
    render(
      <AuditLogRow
        item={makeItem({
          action_type: 'suspend_user',
          target_post_id: null,
          target_user_id: 'user-abc12345',
        })}
        currentUserId={null}
      />
    )
    expect(screen.getByTestId('audit-row-expand-toggle')).not.toBeNull()
  })

  it("shows the user's moderation history and renders NO post block when expanded", () => {
    mockPostDetailData = {
      post_id: 'should-not-appear',
      title: 'Should not render',
      body: 'x',
      is_removed: false,
      is_user_deleted: false,
      author_user_id: 'a',
    }
    mockHistoryData = [
      makeItem({
        action_type: 'suspend_user',
        target_post_id: null,
        target_user_id: 'user-abc12345',
      }),
    ]

    render(
      <AuditLogRow
        item={makeItem({
          action_type: 'suspend_user',
          target_post_id: null,
          target_user_id: 'user-abc12345',
        })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    expect(screen.queryByText('Should not render')).toBeNull()
    expect(document.querySelector('[data-testid="audit-row-panel"]')).not.toBeNull()
  })

  it('enables the target-history hook keyed by target_user_id for a user-only row', () => {
    render(
      <AuditLogRow
        item={makeItem({
          action_type: 'suspend_user',
          target_post_id: null,
          target_user_id: 'user-abc12345',
        })}
        currentUserId={null}
      />
    )
    fireEvent.click(screen.getByTestId('audit-row-expand-toggle'))

    const lastCall = useTargetModerationHistoryMock.mock.calls.at(-1)!
    expect(lastCall[0]).toMatchObject({ targetUserId: 'user-abc12345', enabled: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('boundary rule D7 source-grep', () => {
  it('AuditLogRow.tsx exists', () => {
    expect(existsSync(ROW_PATH), `AuditLogRow.tsx must exist at ${ROW_PATH}`).toBe(true)
  })

  it('AuditLogRow.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(ROW_PATH)).toBe(true)
    const src = readFileSync(ROW_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('AuditLogRow.tsx does NOT import from app/state/store', () => {
    expect(existsSync(ROW_PATH)).toBe(true)
    const src = readFileSync(ROW_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })

  it('AuditLogRow.tsx never passes reason/note into a logger call (NFR privacy guard, static grep)', () => {
    expect(existsSync(ROW_PATH)).toBe(true)
    const src = readFileSync(ROW_PATH, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*\.(reason|note)\b/)
  })
})
