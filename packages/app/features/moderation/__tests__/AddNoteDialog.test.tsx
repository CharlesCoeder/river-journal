// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation/AddNoteDialog.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { AddNoteDialog } from
 * '../AddNoteDialog'` with a module-resolution error.
 *
 * Contract this file locks in for the implementation:
 *   - Controlled dialog: `open` / `onOpenChange` / `postId` / `mutation`
 *     (same externally-owned-mutation shape as the other two dialogs).
 *   - A single required free-text note TextArea (maxLength 500).
 *   - Renders the private-note disclosure copy verbatim.
 *   - Confirm disabled until the note is non-empty (after trim); enabled at
 *     the exact 500-char boundary.
 *   - Confirm calls `mutation.mutate({ note, target_post_id })` (note
 *     trimmed) exactly once per click, gated by `isPending`.
 *   - Cancel/Esc → no mutate call, note resets on reopen.
 *   - A truthy `mutation.error` renders one calm, generic, non-leaking
 *     message (identical across 42501 / 22023).
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DIALOG_PATH = path.resolve(__dirname, '..', 'AddNoteDialog.tsx')

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
    TextArea: ({ value, onChangeText, placeholder, maxLength }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        maxLength,
        'data-testid': 'note-textarea',
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

// ─── Import under test — fails until AddNoteDialog.tsx exists ────────────────
import { AddNoteDialog } from '../AddNoteDialog'

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
      <AddNoteDialog
        open={open}
        onOpenChange={setOpen}
        postId="post-note-1"
        mutation={mutation}
      />
    </div>
  )
}

function makeMutation(overrides: Partial<{ isPending: boolean; error: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...overrides }
}

// Stateful harness — drives a real Confirm → settle lifecycle so the stay-open
// (error) / close (success) behavior is genuinely exercised, not force-mounted.
function FlowHarness({
  outcome,
  mutateSpy,
}: {
  outcome: 'success' | 'error'
  mutateSpy: (vars: unknown) => void
}) {
  const [open, setOpen] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)
  const mutation = {
    isPending: false,
    error,
    reset: () => setError(null),
    mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => {
      mutateSpy(vars)
      if (outcome === 'error') setError({ code: '22023' })
      else opts?.onSuccess?.()
    },
  }
  return (
    <AddNoteDialog
      open={open}
      onOpenChange={setOpen}
      postId="post-flow"
      mutation={mutation}
    />
  )
}

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('private-note disclosure + field', () => {
  it('renders the disclosure copy verbatim', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    expect(
      screen.getByText('This adds a private moderation note. The post is NOT removed.')
    ).not.toBeNull()
  })

  it('renders a required TextArea with maxLength 500', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    const textarea = screen.getByTestId('note-textarea')
    expect(Number(textarea.getAttribute('maxlength'))).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm gating', () => {
  it('Confirm disabled while the note is empty', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm disabled while the note is whitespace-only', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: '   ' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm enables once non-whitespace text is entered', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'borderline case' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('Confirm enables at the exact 500-character boundary', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation()}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'x'.repeat(500) } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('Confirm stays disabled while mutation.isPending, even with valid text', () => {
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="p1"
        mutation={makeMutation({ isPending: true })}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'valid note' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm submit', () => {
  it('calls mutation.mutate exactly once with { note, target_post_id }, note trimmed', () => {
    const mutation = makeMutation()
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="post-77"
        mutation={mutation}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), {
      target: { value: '  keep an eye on this one  ' },
    })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    // A second arg (the { onSuccess } close callback) rides along — assert the vars.
    expect(mutation.mutate.mock.calls[0]![0]).toEqual({
      note: 'keep an eye on this one',
      target_post_id: 'post-77',
    })
  })

  it('does not call mutate on a rapid double-click while isPending is true', () => {
    const mutation = makeMutation({ isPending: true })
    render(
      <AddNoteDialog
        open
        onOpenChange={vi.fn()}
        postId="post-78"
        mutation={mutation}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'note' } })
    const confirm = screen.getByTestId('btn-confirm')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(mutation.mutate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Cancel / Esc — no mutation, state resets', () => {
  it('Cancel closes without calling mutate', () => {
    const mutation = makeMutation()
    const onOpenChange = vi.fn()
    render(
      <AddNoteDialog
        open
        onOpenChange={onOpenChange}
        postId="p1"
        mutation={mutation}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'a note' } })
    fireEvent.click(screen.getByTestId('btn-cancel'))

    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Esc closes without calling mutate', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    const dialog = document.querySelector('[data-dialog="true"]') as HTMLElement
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('false')
  })

  it('reopening after Cancel shows an empty note (state reset)', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'stale note' } })
    fireEvent.click(screen.getByTestId('btn-cancel'))

    fireEvent.click(screen.getByTestId('harness-reopen'))

    expect((screen.getByTestId('note-textarea') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('real Confirm → settle flow — stay-open on error, close on success', () => {
  it('a settled error keeps the dialog OPEN, shows the calm inline error (no code leak), and re-enables Confirm', () => {
    render(
      <FlowHarness
        outcome="error"
        mutateSpy={vi.fn()}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'watch this one' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    // The dialog stays open on error (unlike the old close-on-fire behavior).
    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('true')
    // Calm, generic, non-leaking copy.
    expect(screen.getByText("Couldn't complete that. Try again.")).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/22023/)
    // Confirm re-enabled → pressing it again is the retry.
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('a settled success CLOSES the dialog', () => {
    render(
      <FlowHarness
        outcome="success"
        mutateSpy={vi.fn()}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'watch this one' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('false')
  })

  it('re-firing Confirm after an error attempts the mutation again (retry)', () => {
    const mutateSpy = vi.fn()
    render(
      <FlowHarness
        outcome="error"
        mutateSpy={mutateSpy}
      />
    )
    fireEvent.change(screen.getByTestId('note-textarea'), { target: { value: 'watch this one' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutateSpy).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('source-grep guardrails', () => {
  it('AddNoteDialog.tsx exists', () => {
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
