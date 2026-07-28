// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/moderation/ModerationQueueRow.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import ModerationQueueRow from
 * '../ModerationQueueRow'` with a module-resolution error, per this repo's
 * established red-phase convention (see YourPostsScreen.test.tsx).
 *
 * Contract this file locks in for the implementation:
 *   - Props: `item: ModerationQueueItem` plus optional stub handlers
 *     `onRemove?`, `onAddNote?`, `onSuspend?`, `onDismiss?` (all unwired
 *     no-ops in this change).
 *   - Author display: `item.author_user_id?.slice(0, 8) ?? '[deleted]'`.
 *   - Deletion-state precedence (verbatim, mirrors FeedPostRow/ThreadView/
 *     PostRow): `is_user_deleted` wins when it and `author_user_id === null`
 *     co-occur — render ONLY the "[deleted]" body + "Author self-deleted"
 *     marker, never also "Author deleted account".
 *   - `author_user_id === null` alone (account deleted, content not
 *     self-deleted) renders the ORIGINAL body + "Author deleted account".
 *   - flag-count label pluralizes: "1 report" (singular) vs "N reports".
 *   - Removed rows (`is_removed`) render a muted/struck body + "Removed" tag.
 *   - Tapping the row toggles an expanded list of `item.reports` (reason +
 *     relative time + note-if-present); collapsed by default.
 *   - Null-field guards: `title` null → no empty title node; a report's
 *     `note` null → no note line for that report; `reports` empty → no crash.
 *   - Four stub action affordances render with `data-testid`s
 *     `moderation-action-remove` / `moderation-action-add-note` /
 *     `moderation-action-suspend` / `moderation-action-dismiss` and never
 *     invoke a handler on click when none is wired.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const ROW_PATH = path.join(FEATURES_DIR, 'ModerationQueueRow.tsx')

// ─── Mock the row-hosted mutation hooks (mirrors how FlagAffordance.test.tsx
// mocks app/state/collective/mutations) — no QueryClientProvider needed. ─────
vi.mock('app/state/collective/moderationMutations', () => ({
  useRemovePost: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useSuspendUser: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useAddModerationNote: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements, plus the
// dialog primitives the row's co-located dialog components need. ─────────────
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
    if (props['aria-expanded'] !== undefined) out['aria-expanded'] = String(props['aria-expanded'])
    return out
  }

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = () => ReactModule.createElement('div', { 'data-dialog-overlay': 'true' })
  const DialogContent = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-content': 'true' }, children)
  const DialogTitle = ({ children }: any) => ReactModule.createElement('h2', {}, children)
  const DialogDescription = ({ children }: any) => ReactModule.createElement('p', {}, children)
  const DialogTrigger = ({ children }: any) => children

  const DialogComponent = ({ children, open, onOpenChange }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog': 'true',
        'data-open': String(open),
        role: open ? 'dialog' : undefined,
        onKeyDown: (e: any) => {
          if (e.key === 'Escape') onOpenChange?.(false)
        },
      },
      open ? children : null
    )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
    Trigger: DialogTrigger,
  })

  const RadioGroupItem = ({ value, id }: any) =>
    ReactModule.createElement('input', { type: 'radio', id, value, 'data-radio-item': 'true' })
  const RadioGroupComponent = ({ children, value, onValueChange }: any) =>
    ReactModule.createElement(
      'div',
      {
        role: 'radiogroup',
        'data-rg-value': value ?? '',
        onClick: (e: any) => {
          const target = e.target as HTMLInputElement
          if (target.type === 'radio') onValueChange?.(target.value)
        },
      },
      children
    )
  Object.assign(RadioGroupComponent, { Item: RadioGroupItem })

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
      ...props
    }: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y: Record<string, unknown> = {}
      if (accessible) a11y['data-accessible'] = 'true'
      if (accessibilityRole) a11y['role'] = accessibilityRole
      if (role) a11y['role'] = role
      if (accessibilityLabel) a11y['aria-label'] = accessibilityLabel
      if (ariaLabel) a11y['aria-label'] = ariaLabel
      if (ariaExpanded !== undefined) a11y['aria-expanded'] = String(ariaExpanded)
      if (dataTestId) a11y['data-testid'] = dataTestId
      if (onPress) a11y['onClick'] = onPress
      return ReactModule.createElement(htmlTag, a11y, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    Separator: (_props: any) => ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    Dialog: DialogComponent,
    RadioGroup: RadioGroupComponent,
    Label: ({ children, htmlFor }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),
    TextArea: ({ value, onChangeText, maxLength }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        maxLength,
        'data-testid': 'textarea',
      }),
    Input: ({ value, onChangeText }: any) =>
      ReactModule.createElement('input', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        'data-testid': 'suspend-custom-days-input',
      }),
    ExpandingLineButton: ({ children, onPress, disabled }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => false,
    useToastController: () => ({ show: vi.fn() }),
  }
})

// ─── Import under test — fails until ModerationQueueRow.tsx exists ───────────
// eslint-disable-next-line import/first
import ModerationQueueRow from '../ModerationQueueRow'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
type Report = { id: string; reason_code: string; note: string | null; created_at: string }

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-default',
    reason_code: 'spam',
    note: null,
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  const reports = (overrides.reports as Report[] | undefined) ?? [makeReport()]
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
    flag_count: reports.length,
    latest_report_reason: reports[reports.length - 1]?.reason_code ?? null,
    latest_report_note: reports[reports.length - 1]?.note ?? null,
    latest_report_at: reports[reports.length - 1]?.created_at ?? null,
    reports,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('author display', () => {
  it('renders the first 8 characters of author_user_id', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: 'abcdefgh12345' })} />)
    expect(screen.getByText(/abcdefgh/)).not.toBeNull()
  })

  it('renders "[deleted]" when author_user_id is null and content is not self-deleted', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: null, is_user_deleted: false })} />)
    expect(screen.getAllByText('[deleted]').length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('deletion-state precedence (is_user_deleted wins over null author)', () => {
  it('self-deleted content: renders [deleted] body + "Author self-deleted", author present', () => {
    render(
      <ModerationQueueRow
        item={makeItem({
          is_user_deleted: true,
          author_user_id: 'author-abc12345',
          body: 'original body',
        })}
      />
    )
    expect(screen.getByText('Author self-deleted')).not.toBeNull()
    expect(screen.queryByText('original body')).toBeNull()
  })

  it('account-deleted only (author null, NOT self-deleted): renders ORIGINAL body + "Author deleted account"', () => {
    render(
      <ModerationQueueRow
        item={makeItem({
          is_user_deleted: false,
          author_user_id: null,
          body: 'still-visible body',
        })}
      />
    )
    expect(screen.getByText('Author deleted account')).not.toBeNull()
    expect(screen.getByText('still-visible body')).not.toBeNull()
  })

  it('co-occurring is_user_deleted + author_user_id null: is_user_deleted wins — ONLY the self-deleted marker renders', () => {
    render(
      <ModerationQueueRow
        item={makeItem({
          is_user_deleted: true,
          author_user_id: null,
          body: 'should-not-render body',
        })}
      />
    )
    expect(screen.getByText('Author self-deleted')).not.toBeNull()
    expect(screen.queryByText('Author deleted account')).toBeNull()
    expect(screen.queryByText('should-not-render body')).toBeNull()
  })

  it('normal row (no deletion flags): renders neither deletion marker', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    expect(screen.queryByText('Author self-deleted')).toBeNull()
    expect(screen.queryByText('Author deleted account')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('flag-count label pluralization', () => {
  it('renders "1 report" (singular) when flag_count === 1', () => {
    render(<ModerationQueueRow item={makeItem({ flag_count: 1, reports: [makeReport()] })} />)
    expect(screen.getByText('1 report')).not.toBeNull()
    expect(screen.queryByText('1 reports')).toBeNull()
  })

  it('renders "3 reports" (plural) when flag_count === 3', () => {
    render(
      <ModerationQueueRow
        item={makeItem({
          flag_count: 3,
          reports: [makeReport({ id: 'r1' }), makeReport({ id: 'r2' }), makeReport({ id: 'r3' })],
        })}
      />
    )
    expect(screen.getByText('3 reports')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('removed-post muted rendering', () => {
  it('renders a "Removed" marker when is_removed === true', () => {
    render(<ModerationQueueRow item={makeItem({ is_removed: true })} />)
    expect(screen.getByText('Removed')).not.toBeNull()
  })

  it('does NOT render a "Removed" marker for a non-removed post', () => {
    render(<ModerationQueueRow item={makeItem({ is_removed: false })} />)
    expect(screen.queryByText('Removed')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('null/empty field guards', () => {
  it('title null (a reply): renders body without an empty title node', () => {
    render(<ModerationQueueRow item={makeItem({ title: null, body: 'reply body text' })} />)
    expect(screen.getByText('reply body text')).not.toBeNull()
  })

  it('latest_report_note null: the collapsed preview shows the reason only', () => {
    render(
      <ModerationQueueRow
        item={makeItem({ latest_report_reason: 'off_topic', latest_report_note: null })}
      />
    )
    expect(screen.getByText(/off_topic/)).not.toBeNull()
  })

  it('a report with null note in the expanded list: no note line rendered for it', () => {
    const reports = [makeReport({ id: 'no-note-report', reason_code: 'spam', note: null })]
    render(<ModerationQueueRow item={makeItem({ reports })} />)
    fireEvent.click(screen.getByTestId('moderation-row-expand-toggle'))
    // No stray "note:" affordance text should render for a null note.
    expect(screen.queryByText(/note:/i)).toBeNull()
  })

  it('an unexpectedly empty reports array does not crash the row', () => {
    expect(() => render(<ModerationQueueRow item={makeItem({ reports: [] })} />)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('expand-to-show-reports toggle', () => {
  it('is collapsed by default: does not show individual report reason_codes', () => {
    const reports = [
      makeReport({ id: 'r1', reason_code: 'spam', created_at: '2026-07-01T00:00:00.000Z' }),
      makeReport({ id: 'r2', reason_code: 'harassment', created_at: '2026-07-02T00:00:00.000Z' }),
    ]
    render(<ModerationQueueRow item={makeItem({ reports, flag_count: 2 })} />)
    const list = document.querySelector('[data-testid="moderation-row-reports"]')
    expect(list).toBeNull()
  })

  it('tapping the row expands the list of individual pending reports', () => {
    const reports = [
      makeReport({ id: 'r1', reason_code: 'spam', note: 'first note' }),
      makeReport({ id: 'r2', reason_code: 'harassment', note: 'second note' }),
    ]
    render(<ModerationQueueRow item={makeItem({ reports, flag_count: 2 })} />)

    fireEvent.click(screen.getByTestId('moderation-row-expand-toggle'))

    const list = document.querySelector('[data-testid="moderation-row-reports"]')
    expect(list).not.toBeNull()
    expect(screen.getByText('first note')).not.toBeNull()
    expect(screen.getByText('second note')).not.toBeNull()
  })

  it('tapping an expanded row a second time collapses it again', () => {
    const reports = [makeReport({ id: 'r1', reason_code: 'spam', note: 'toggle note' })]
    render(<ModerationQueueRow item={makeItem({ reports, flag_count: 1 })} />)

    const toggle = screen.getByTestId('moderation-row-expand-toggle')
    fireEvent.click(toggle)
    expect(document.querySelector('[data-testid="moderation-row-reports"]')).not.toBeNull()

    fireEvent.click(toggle)
    expect(document.querySelector('[data-testid="moderation-row-reports"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('stubbed action affordances', () => {
  it('renders all four action affordances', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    expect(document.querySelector('[data-testid="moderation-action-remove"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="moderation-action-add-note"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="moderation-action-suspend"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="moderation-action-dismiss"]')).not.toBeNull()
  })

  it('clicking the stubbed affordances does NOT invoke any handler when none is wired', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const remove = document.querySelector('[data-testid="moderation-action-remove"]') as Element
    // Must not throw when no on* prop is supplied.
    expect(() => fireEvent.click(remove)).not.toThrow()
  })

  it('clicking Remove opens the removal dialog (row owns the dialog now)', () => {
    render(<ModerationQueueRow item={makeItem({ post_id: 'post-xyz' })} />)
    const remove = document.querySelector('[data-testid="moderation-action-remove"]') as Element
    fireEvent.click(remove)
    expect(document.querySelector('[data-dialog="true"][data-open="true"]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('body preview truncation', () => {
  it('truncates a very long body rather than rendering it verbatim inline', () => {
    const longBody = 'word '.repeat(600).trim()
    render(<ModerationQueueRow item={makeItem({ body: longBody })} />)
    expect(screen.queryByText(longBody)).toBeNull()
  })

  it('renders a short body verbatim (no truncation needed)', () => {
    render(<ModerationQueueRow item={makeItem({ body: 'short body' })} />)
    expect(screen.getByText('short body')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('boundary rule D7 source-grep', () => {
  it('ModerationQueueRow.tsx exists', () => {
    expect(existsSync(ROW_PATH), `ModerationQueueRow.tsx must exist at ${ROW_PATH}`).toBe(true)
  })

  it('ModerationQueueRow.tsx does NOT contain @legendapp/state import', () => {
    expect(existsSync(ROW_PATH)).toBe(true)
    const src = readFileSync(ROW_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('ModerationQueueRow.tsx does NOT import from app/state/store', () => {
    expect(existsSync(ROW_PATH)).toBe(true)
    const src = readFileSync(ROW_PATH, 'utf8')
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})
