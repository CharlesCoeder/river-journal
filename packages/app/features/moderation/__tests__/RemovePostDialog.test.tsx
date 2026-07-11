// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation/RemovePostDialog.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { RemovePostDialog } from
 * '../RemovePostDialog'` with a module-resolution error, per this repo's
 * established red-phase convention (see `FlagAffordance.test.tsx`).
 *
 * Contract this file locks in for the implementation (mirrors the dialog
 * pattern in `features/collective/FlagAffordance.tsx`):
 *   - Controlled dialog: `open` / `onOpenChange` props (no internal Trigger —
 *     the row hosts `Dialog.Trigger asChild` around the affordance and owns
 *     the mutation hook; this component receives the mutation result as a
 *     prop so its `isPending` state survives a co-located dialog's unmount).
 *   - Props: `open`, `onOpenChange`, `postId`, `mutation` (an object shaped
 *     like a `useMutation` result: `mutate`, `isPending`, `error`).
 *   - Renders a radio list of the six templated removal reasons + an
 *     optional free-text note (maxLength 500).
 *   - Confirm is disabled until a reason is chosen, or while `isPending`.
 *   - Confirm calls `mutation.mutate({ target_post_id, reason_code,
 *     custom_note })` exactly once per click; a whitespace-only note maps to
 *     `custom_note: null`.
 *   - Cancel and Esc both close with NO mutate call, and reset local state
 *     (selected reason + note) so a later reopen starts clean.
 *   - Removal is the optimistic EXCEPTION: Confirm fires the mutation and
 *     closes immediately (the row is patched struck-through and rolled back on
 *     error). This dialog renders NO inline error — a failed remove is
 *     surfaced by the row's toast (covered in
 *     `ModerationQueueRow.actions.test.tsx`), never silently swallowed.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DIALOG_PATH = path.resolve(__dirname, '..', 'RemovePostDialog.tsx')

// ─── @my/ui mock — mirrors FlagAffordance.test.tsx's mock, plus Escape
// handling on the Dialog wrapper (simulating the real tamagui/Radix Dialog
// primitive's native Esc-to-close behavior, which this lightweight mock
// otherwise has no way to exercise). ───────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = ({ animation }: any) =>
    ReactModule.createElement('div', {
      'data-dialog-overlay': 'true',
      'data-animation': animation ?? '',
    })
  const DialogContent = ({ children, animation }: any) =>
    ReactModule.createElement(
      'div',
      { 'data-dialog-content': 'true', 'data-animation': animation ?? '' },
      children
    )
  const DialogTitle = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)
  const DialogDescription = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-dialog-desc': 'true' }, children)

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
  })

  return {
    View: ({ children, tag, onPress, ...props }: any) => {
      const htmlProps: Record<string, unknown> = {}
      if (props['data-testid']) htmlProps['data-testid'] = props['data-testid']
      if (onPress) htmlProps['onClick'] = onPress
      return ReactModule.createElement(tag === 'button' ? 'button' : 'div', htmlProps, children)
    },
    Text: ({ children }: any) => ReactModule.createElement('span', {}, children),
    XStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    Dialog: DialogComponent,
    RadioGroup: RadioGroupComponent,
    Label: ({ children, htmlFor }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),
    TextArea: ({ value, onChangeText, placeholder, maxLength }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        maxLength,
        'data-testid': 'remove-note-textarea',
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
  }
})

// ─── Import under test — fails until RemovePostDialog.tsx exists ─────────────
import { RemovePostDialog } from '../RemovePostDialog'

// ─── Harness: gives the dialog a real open/close lifecycle so
// "resets on close" and "reopen starts clean" are meaningfully testable. ─────
function Harness({ mutation }: { mutation: any }) {
  const [open, setOpen] = React.useState(true)
  return (
    <div>
      <button
        data-testid="harness-reopen"
        onClick={() => setOpen(true)}
      >
        reopen
      </button>
      <RemovePostDialog
        open={open}
        onOpenChange={setOpen}
        postId="post-42"
        mutation={mutation}
      />
    </div>
  )
}

function makeMutation(overrides: Partial<{ isPending: boolean; error: unknown }> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('templated reasons radio list', () => {
  it('renders all six templated removal reasons', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    for (const label of [
      'Harassment',
      'Off-topic',
      'Spam',
      'Threats',
      'Illegal content',
      'Other',
    ]) {
      expect(screen.getByText(label)).not.toBeNull()
    }
  })

  it('renders exactly six reason radio inputs with the expected reason codes', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    const radios = document.querySelectorAll('input[type="radio"]')
    const values = Array.from(radios).map((r) => (r as HTMLInputElement).value)
    expect(values.sort()).toEqual(
      ['harassment', 'off_topic', 'spam', 'threats', 'illegal_content', 'other'].sort()
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('optional note field', () => {
  it('renders a TextArea with maxLength 500', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    const textarea = screen.getByTestId('remove-note-textarea')
    expect(Number(textarea.getAttribute('maxlength'))).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm gating', () => {
  it('Confirm is disabled until a reason is selected', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    const confirm = screen.getByTestId('btn-confirm')
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm enables after a reason is selected', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    const spamRadio = document.querySelector('input[value="spam"]') as HTMLInputElement
    fireEvent.click(spamRadio)
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('Confirm stays disabled while mutation.isPending is true, even with a reason selected', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation({ isPending: true })}
      />
    )
    const spamRadio = document.querySelector('input[value="spam"]') as HTMLInputElement
    fireEvent.click(spamRadio)
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm submit', () => {
  it('calls mutation.mutate exactly once with { target_post_id, reason_code, custom_note }', () => {
    const mutation = makeMutation()
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="post-abc"
        mutation={mutation}
      />
    )
    fireEvent.click(document.querySelector('input[value="threats"]') as HTMLInputElement)
    fireEvent.change(screen.getByTestId('remove-note-textarea'), { target: { value: 'context' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    expect(mutation.mutate).toHaveBeenCalledWith({
      target_post_id: 'post-abc',
      reason_code: 'threats',
      custom_note: 'context',
    })
  })

  it('a whitespace-only note is sent as custom_note: null', () => {
    const mutation = makeMutation()
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="post-ws"
        mutation={mutation}
      />
    )
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.change(screen.getByTestId('remove-note-textarea'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ custom_note: null }))
  })

  it('does not call mutate a second time on a rapid double-click while isPending is true', () => {
    const mutation = makeMutation({ isPending: true })
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="post-dbl"
        mutation={mutation}
      />
    )
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    const confirm = screen.getByTestId('btn-confirm')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(mutation.mutate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Cancel / Esc — no mutation, state resets', () => {
  it('Cancel closes the dialog without calling mutate', () => {
    const mutation = makeMutation()
    const onOpenChange = vi.fn()
    render(
      <RemovePostDialog
        open
        onOpenChange={onOpenChange}
        postId="p1"
        mutation={mutation}
      />
    )
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-cancel'))

    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Esc closes the dialog without calling mutate', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    const dialog = document.querySelector('[data-dialog="true"]') as HTMLElement
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('false')
  })

  it('reopening after Cancel shows an empty note and no reason selected (state reset)', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    fireEvent.click(document.querySelector('input[value="other"]') as HTMLInputElement)
    fireEvent.change(screen.getByTestId('remove-note-textarea'), {
      target: { value: 'stale note' },
    })
    fireEvent.click(screen.getByTestId('btn-cancel'))

    fireEvent.click(screen.getByTestId('harness-reopen'))

    const textarea = screen.getByTestId('remove-note-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm closes the dialog (optimistic fire-and-forget)', () => {
  it('fires the mutation and closes immediately, without waiting for it to settle', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    fireEvent.click(document.querySelector('input[value="spam"]') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    // The optimistic row patch (+ rollback-on-error) gives the feedback; the
    // dialog does not linger. A failed remove is surfaced by the ROW's toast,
    // covered in ModerationQueueRow.actions.test.tsx.
    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('false')
  })

  it('renders no inline error line for this dialog (errors are a row-level toast)', () => {
    render(
      <RemovePostDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation({ error: { code: '22023', message: 'invalid input' } })}
      />
    )
    expect(document.body.textContent).not.toMatch(/couldn't complete/i)
    expect(document.body.textContent).not.toMatch(/22023/)
    expect(document.body.textContent).not.toMatch(/invalid input/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('source-grep guardrails', () => {
  it('RemovePostDialog.tsx exists', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
  })

  it('does NOT import @legendapp/state (D7 boundary rule)', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
    const src = readFileSync(DIALOG_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('does NOT contain a console.* call with "note" in the same expression (NFR19)', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
    const src = readFileSync(DIALOG_PATH, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*note/i)
  })
})
