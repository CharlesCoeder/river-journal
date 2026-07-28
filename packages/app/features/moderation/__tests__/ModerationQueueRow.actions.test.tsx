// @vitest-environment happy-dom
/**
 * Red-phase unit tests for the removal/suspension/note wiring INTO
 * `features/moderation/ModerationQueueRow.tsx`.
 *
 * This is a NEW, separate file from the existing (already-committed)
 * `ModerationQueueRow.test.tsx`. That file renders the row with no
 * QueryClientProvider and no mock of any mutation module, and asserts the
 * OLD contract (`onRemove(postId)` firing directly on a click). Once the row
 * calls `useRemovePost()` / `useSuspendUser()` / `useAddModerationNote()`,
 * every test in that file would need updating — that update is a separate,
 * deliberate step (extend its `@my/ui` mock, mock
 * `app/state/collective/moderationMutations`, replace the stale `onRemove`
 * assertion) and is NOT made here. This file locks in the NEW wiring
 * contract using a from-scratch render harness, mirroring how
 * `FlagAffordance.test.tsx` mocks `app/state/collective/mutations` (no
 * QueryClientProvider needed — the mutation hooks are mocked outright).
 *
 * Red-phase contract: these tests fail now — either because
 * `app/state/collective/moderationMutations`, `../RemovePostDialog`,
 * `../SuspendUserDialog`, or `../AddNoteDialog` don't exist yet (module
 * resolution), or because the CURRENT `ModerationQueueRow.tsx` still exposes
 * the old stub `on*` props instead of real dialogs (assertion failures).
 *
 * Contract locked in here:
 *   - Remove / Add note / Suspend author affordances each open their dialog.
 *   - Suspend author is disabled/absent when `author_user_id === null`.
 *   - Confirming a dialog calls the matching mocked mutation hook's
 *     `mutate` with the row's `post_id` / `author_user_id`.
 *   - The three mutation hooks are each invoked exactly once per row render
 *     — i.e. hosted at the row level, not remounted when a dialog opens/
 *     closes (the double-submit guard depends on `isPending` surviving a
 *     fire-and-forget close).
 *   - The Remove dialog snapshots `post_id` at open time: if the row's
 *     `item` prop changes (a concurrent queue refetch reordering rows)
 *     while the dialog stays open, Confirm still targets the ORIGINAL id.
 *   - Action affordances still `stopPropagation` (opening a dialog never
 *     toggles the row's own expand state).
 *   - a11y: the row container is `role="article"` ONLY (no co-declared
 *     `role="button"`); a dedicated expand toggle carries button semantics +
 *     `aria-expanded`.
 *   - "Dismiss reports" stays inert (no RPC exists for it yet).
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Hoisted mutation spies — mirrors FlagAffordance.test.tsx's pattern ──────
const {
  removeMutateSpy,
  suspendMutateSpy,
  noteMutateSpy,
  toastShowSpy,
  useRemovePostCallCount,
  useSuspendUserCallCount,
  useAddModerationNoteCallCount,
} = vi.hoisted(() => ({
  removeMutateSpy: vi.fn(),
  suspendMutateSpy: vi.fn(),
  noteMutateSpy: vi.fn(),
  toastShowSpy: vi.fn(),
  useRemovePostCallCount: { current: 0 },
  useSuspendUserCallCount: { current: 0 },
  useAddModerationNoteCallCount: { current: 0 },
}))

let removeIsPending = false
let suspendIsPending = false
let noteIsPending = false

vi.mock('app/state/collective/moderationMutations', () => ({
  useRemovePost: () => {
    useRemovePostCallCount.current += 1
    return { mutate: removeMutateSpy, isPending: removeIsPending, error: null, reset: vi.fn() }
  },
  useSuspendUser: () => {
    useSuspendUserCallCount.current += 1
    return { mutate: suspendMutateSpy, isPending: suspendIsPending, error: null, reset: vi.fn() }
  },
  useAddModerationNote: () => {
    useAddModerationNoteCallCount.current += 1
    return { mutate: noteMutateSpy, isPending: noteIsPending, error: null, reset: vi.fn() }
  },
}))

// ─── @my/ui mock — the row's own primitives plus the dialog primitives the
// three (real, unmocked) dialog components need. ──────────────────────────
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
    if (props.accessibilityExpanded !== undefined)
      out['aria-expanded'] = String(props.accessibilityExpanded)
    return out
  }

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = () => ReactModule.createElement('div', { 'data-dialog-overlay': 'true' })
  const DialogContent = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-content': 'true' }, children)
  const DialogTitle = ({ children }: any) => ReactModule.createElement('h2', {}, children)
  const DialogDescription = ({ children }: any) => ReactModule.createElement('p', {}, children)
  // Passthrough: opening/closing is driven by the row's own local state via
  // the affordance's onPress, not by Trigger-context magic in this mock.
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
    Text: ({ children, tag }: any) => {
      const htmlTag = typeof tag === 'string' ? tag : 'span'
      return ReactModule.createElement(htmlTag, {}, children)
    },

    // forwardRef so the affordance's focus-return ref attaches to the DOM node
    // (happy-dom .focus() then sets document.activeElement, even on a div).
    View: ReactModule.forwardRef(({ children, tag, onPress, ...props }: any, ref: any) => {
      const htmlTag = tag === 'article' ? 'article' : 'div'
      const a11y = mapA11y(props)
      if (onPress) a11y['onClick'] = onPress
      if (ref) a11y['ref'] = ref
      return ReactModule.createElement(htmlTag, a11y, children)
    }),

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),
    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),
    Separator: () => ReactModule.createElement('hr', { 'data-testid': 'separator' }),

    Dialog: DialogComponent,
    RadioGroup: RadioGroupComponent,
    Label: ({ children, htmlFor }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),
    TextArea: ({ value, onChangeText, maxLength, 'data-testid': testId }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        maxLength,
        'data-testid': testId ?? 'textarea',
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
    useToastController: () => ({ show: toastShowSpy }),
  }
})

// ─── Import under test — resolves to the CURRENT ModerationQueueRow.tsx
// (which exists) or fails at module resolution once it starts importing
// RemovePostDialog/SuspendUserDialog/AddNoteDialog that don't exist yet. ────
import ModerationQueueRow from '../ModerationQueueRow'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
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
    latest_report_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    reports: [{ id: 'r1', reason_code: 'spam', note: null, created_at: new Date().toISOString() }],
    ...overrides,
  }
}

function openRemoveDialog() {
  fireEvent.click(screen.getByTestId('moderation-action-remove'))
}
function openNoteDialog() {
  fireEvent.click(screen.getByTestId('moderation-action-add-note'))
}
function openSuspendDialog() {
  fireEvent.click(screen.getByTestId('moderation-action-suspend'))
}

beforeEach(() => {
  removeMutateSpy.mockReset()
  suspendMutateSpy.mockReset()
  noteMutateSpy.mockReset()
  toastShowSpy.mockReset()
  useRemovePostCallCount.current = 0
  useSuspendUserCallCount.current = 0
  useAddModerationNoteCallCount.current = 0
  removeIsPending = false
  suspendIsPending = false
  noteIsPending = false
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('dialogs open from their affordance', () => {
  it('clicking Remove opens the removal dialog (reason radios visible)', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    openRemoveDialog()
    expect(screen.getByText('Harassment')).not.toBeNull()
    expect(document.querySelector('[data-dialog="true"][data-open="true"]')).not.toBeNull()
  })

  it('clicking Add note opens the note dialog (disclosure text visible)', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    openNoteDialog()
    expect(
      screen.getByText('This adds a private moderation note. The post is NOT removed.')
    ).not.toBeNull()
  })

  it('clicking Suspend author opens the suspension dialog (scope-warning text visible)', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: 'author-present' })} />)
    openSuspendDialog()
    expect(
      screen.getByText(
        'Suspension blocks posting and reacting only. Writing and reading remain available.'
      )
    ).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Suspend affordance guard — no user to suspend', () => {
  it('is absent, or present-but-disabled, when author_user_id is null', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: null })} />)
    const suspend = document.querySelector('[data-testid="moderation-action-suspend"]')
    if (suspend) {
      expect(suspend.getAttribute('aria-disabled')).toBe('true')
    } else {
      expect(suspend).toBeNull()
    }
  })

  it('is present and enabled when author_user_id is set', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: 'author-present' })} />)
    const suspend = screen.getByTestId('moderation-action-suspend')
    expect(suspend.getAttribute('aria-disabled')).not.toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('confirming a dialog calls the matching mutation with the row target', () => {
  it('Remove: mutate called with target_post_id === item.post_id', () => {
    render(<ModerationQueueRow item={makeItem({ post_id: 'post-remove-me' })} />)
    openRemoveDialog()
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(removeMutateSpy).toHaveBeenCalledTimes(1)
    expect(removeMutateSpy.mock.calls[0]![0]).toMatchObject({ target_post_id: 'post-remove-me' })
  })

  it('Suspend: mutate called with target_user_id === item.author_user_id', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: 'author-target' })} />)
    openSuspendDialog()
    fireEvent.click(document.querySelector('input[value="1"]') as HTMLInputElement)
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(suspendMutateSpy).toHaveBeenCalledTimes(1)
    expect(suspendMutateSpy.mock.calls[0]![0]).toMatchObject({ target_user_id: 'author-target' })
  })

  it('Add note: mutate called with target_post_id === item.post_id', () => {
    render(<ModerationQueueRow item={makeItem({ post_id: 'post-note-me' })} />)
    openNoteDialog()
    const textareas = document.querySelectorAll('textarea')
    fireEvent.change(textareas[textareas.length - 1]!, { target: { value: 'watch this one' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(noteMutateSpy).toHaveBeenCalledTimes(1)
    expect(noteMutateSpy.mock.calls[0]![0]).toMatchObject({ target_post_id: 'post-note-me' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('hooks are hosted at the row level (not remounted per dialog open/close)', () => {
  it('useRemovePost is invoked the same number of times whether or not the dialog is opened/closed/reopened', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const callsBefore = useRemovePostCallCount.current
    expect(callsBefore).toBeGreaterThan(0)

    openRemoveDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))
    openRemoveDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))

    // A row-hosted hook is called once (or a small, render-driven, constant
    // number of times) — it must NOT scale with how many times the dialog
    // opened and closed, which would indicate the dialog child owns the hook
    // and isPending resets on every unmount.
    expect(useRemovePostCallCount.current).toBeLessThanOrEqual(callsBefore + 2)
  })

  it('double-submit guard survives a fire-and-forget close: Confirm is a no-op while isPending is true even immediately after reopening', () => {
    removeIsPending = true
    render(<ModerationQueueRow item={makeItem()} />)
    openRemoveDialog()
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(removeMutateSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('target snapshot — Confirm never retargets to a mid-flight prop change', () => {
  it('Remove dialog keeps targeting the post_id it was opened with, even if the item prop changes while it stays open', () => {
    const { rerender } = render(
      <ModerationQueueRow item={makeItem({ post_id: 'post-original' })} />
    )
    openRemoveDialog()

    // Simulate a concurrent queue refetch swapping in a different post at the
    // same row position while the dialog is still open.
    rerender(<ModerationQueueRow item={makeItem({ post_id: 'post-swapped-in' })} />)

    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(removeMutateSpy).toHaveBeenCalledTimes(1)
    expect(removeMutateSpy.mock.calls[0]![0]).toMatchObject({ target_post_id: 'post-original' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('opening a dialog never toggles the row expand (stopPropagation preserved)', () => {
  it('clicking Remove does not reveal the expanded reports list', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    openRemoveDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(document.querySelector('[data-testid="moderation-row-reports"]')).toBeNull()
  })

  it('clicking Add note does not reveal the expanded reports list', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    openNoteDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(document.querySelector('[data-testid="moderation-row-reports"]')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a11y — split role="article" (landmark) from the expand toggle (button semantics)', () => {
  it('the row container declares role="article" and NOT role="button"', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const article = document.querySelector('article')
    expect(article).not.toBeNull()
    expect(article!.getAttribute('role')).toBe('article')
  })

  it('a dedicated expand toggle exists with button semantics and aria-expanded', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const toggle = screen.getByRole('button', { name: /expand|reports|show/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('activating the expand toggle flips aria-expanded to true and reveals the reports list', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const toggle = screen.getByRole('button', { name: /expand|reports|show/i })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-testid="moderation-row-reports"]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('focus returns to the triggering affordance on close (ref fallback)', () => {
  it('Cancel returns focus to the Remove affordance', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const remove = screen.getByTestId('moderation-action-remove')
    openRemoveDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(document.activeElement).toBe(remove)
  })

  it('Esc returns focus to the Add note affordance', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const note = screen.getByTestId('moderation-action-add-note')
    openNoteDialog()
    // The row renders all three dialogs; target the OPEN one.
    const dialog = document.querySelector('[data-dialog="true"][data-open="true"]') as HTMLElement
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(document.activeElement).toBe(note)
  })

  it('Cancel returns focus to the Suspend affordance', () => {
    render(<ModerationQueueRow item={makeItem({ author_user_id: 'author-present' })} />)
    const suspend = screen.getByTestId('moderation-action-suspend')
    openSuspendDialog()
    fireEvent.click(screen.getByTestId('btn-cancel'))
    expect(document.activeElement).toBe(suspend)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a failed remove is surfaced (never silent) via a row-level toast', () => {
  it('shows a calm toast when the remove mutation errors', () => {
    // The remove mutation is optimistic + fire-and-forget: the row wraps mutate
    // with an onError that fires a toast. Drive that error here.
    removeMutateSpy.mockImplementation((_vars: unknown, opts?: { onError?: () => void }) =>
      opts?.onError?.()
    )
    render(<ModerationQueueRow item={makeItem({ post_id: 'post-boom' })} />)
    openRemoveDialog()
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(removeMutateSpy).toHaveBeenCalledTimes(1)
    expect(toastShowSpy).toHaveBeenCalledTimes(1)
    // Calm copy, no SQLSTATE leak.
    const [title, opts] = toastShowSpy.mock.calls[0]!
    const combined = `${title} ${opts?.message ?? ''}`
    expect(combined).not.toMatch(/42501|22023/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('"Dismiss reports" stays inert', () => {
  it('clicking Dismiss reports does not throw and calls no mutation', () => {
    render(<ModerationQueueRow item={makeItem()} />)
    const dismiss = screen.getByTestId('moderation-action-dismiss')
    expect(() => fireEvent.click(dismiss)).not.toThrow()
    expect(removeMutateSpy).not.toHaveBeenCalled()
    expect(suspendMutateSpy).not.toHaveBeenCalled()
    expect(noteMutateSpy).not.toHaveBeenCalled()
  })
})
