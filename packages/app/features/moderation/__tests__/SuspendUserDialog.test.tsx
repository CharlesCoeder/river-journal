// @vitest-environment happy-dom
/**
 * Red-phase unit tests for `features/moderation/SuspendUserDialog.tsx`.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level `import { SuspendUserDialog } from
 * '../SuspendUserDialog'` with a module-resolution error.
 *
 * Contract this file locks in for the implementation:
 *   - Controlled dialog: `open` / `onOpenChange` / `authorUserId` / `mutation`
 *     (same externally-owned-mutation shape as `RemovePostDialog`).
 *   - Preset durations (1 / 7 / 30 days) plus a custom-days numeric field
 *     (`data-testid="suspend-custom-days-input"`).
 *   - Precedence rule (pinned so it is never ambiguous): a VALID non-empty
 *     custom-days value always wins over a selected preset. An invalid
 *     custom-days value (empty/0/negative/decimal/non-numeric) is ignored —
 *     the preset selection (if any) is used instead.
 *   - A required templated reason (same six codes as the removal dialog) +
 *     optional custom note.
 *   - Renders the FR26 scope-warning copy verbatim.
 *   - Confirm calls `mutation.mutate({ target_user_id, duration_days, reason
 *     })` — `kind` is NOT a var this dialog sends (fixed inside the mutation
 *     layer).
 *   - Confirm disabled until both a duration and a reason are resolved, or
 *     while `isPending`.
 *   - Cancel/Esc → no mutate call, state resets.
 *   - A truthy `mutation.error` renders one calm, generic, non-leaking
 *     message (identical across 42501 / 22023).
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DIALOG_PATH = path.resolve(__dirname, '..', 'SuspendUserDialog.tsx')

// ─── @my/ui mock — same shape as RemovePostDialog.test.tsx, plus a plain
// Input for the custom-days numeric field. ────────────────────────────────
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

  // Each RadioGroup instance owns its own onClick boundary, so two sibling
  // RadioGroups (duration preset + reason) never cross-fire onValueChange.
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
        'data-testid': 'suspend-note-textarea',
      }),
    Input: ({ value, onChangeText, placeholder, ...props }: any) =>
      ReactModule.createElement('input', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        'data-testid': 'suspend-custom-days-input',
        ...(props.keyboardType ? { inputMode: 'numeric' } : {}),
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

// ─── Import under test — fails until SuspendUserDialog.tsx exists ────────────
import { SuspendUserDialog } from '../SuspendUserDialog'

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
      <SuspendUserDialog
        open={open}
        onOpenChange={setOpen}
        authorUserId="author-77"
        mutation={mutation}
      />
    </div>
  )
}

function makeMutation(overrides: Partial<{ isPending: boolean; error: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...overrides }
}

// Stateful harness — drives a real Confirm → settle lifecycle (stay-open on
// error, close on success) rather than force-mounting an error.
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
    <SuspendUserDialog
      open={open}
      onOpenChange={setOpen}
      authorUserId="author-flow"
      mutation={mutation}
    />
  )
}

function selectReason(code: string) {
  fireEvent.click(document.querySelector(`input[value="${code}"]`) as HTMLInputElement)
}

function selectPreset(days: '1' | '7' | '30') {
  fireEvent.click(document.querySelector(`input[value="${days}"]`) as HTMLInputElement)
}

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('preset durations + custom days', () => {
  it('renders the three preset duration options', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    expect(screen.getByText('1 day')).not.toBeNull()
    expect(screen.getByText('7 days')).not.toBeNull()
    expect(screen.getByText('30 days')).not.toBeNull()
  })

  it('renders a custom-days numeric input', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    expect(screen.getByTestId('suspend-custom-days-input')).not.toBeNull()
  })

  it('renders the FR26 scope-warning copy verbatim', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    expect(
      screen.getByText(
        'Suspension blocks posting and reacting only. Writing and reading remain available.'
      )
    ).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm gating — duration + reason both required', () => {
  it('Confirm disabled with neither duration nor reason set', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm disabled with a reason but no duration', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    selectReason('spam')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm disabled with a duration preset but no reason', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    selectPreset('7')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('Confirm enabled once a preset AND a reason are set', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    selectPreset('1')
    selectReason('spam')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('Confirm stays disabled while mutation.isPending, even with valid inputs', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation({ isPending: true })}
      />
    )
    selectPreset('1')
    selectReason('spam')
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('custom-days validation + preset-vs-custom precedence', () => {
  it.each(['', '0', '-1', '1.5', 'abc'])(
    'rejects invalid custom-days input %j — Confirm stays gated on the preset alone',
    (invalid) => {
      render(
        <SuspendUserDialog
          open
          onOpenChange={vi.fn()}
          authorUserId="a1"
          mutation={makeMutation()}
        />
      )
      selectReason('spam')
      fireEvent.change(screen.getByTestId('suspend-custom-days-input'), {
        target: { value: invalid },
      })
      // No preset selected either — Confirm must stay disabled: invalid custom
      // days must NOT be coerced into a usable duration.
      expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
    }
  )

  it('a valid custom-days value alone (no preset) enables Confirm', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectReason('spam')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '5' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')

    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 5 }),
      expect.anything()
    )
  })

  it('a valid custom-days value overrides a selected preset (custom wins)', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectReason('spam')
    selectPreset('7')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '14' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 14 }),
      expect.anything()
    )
  })

  it('an invalid custom-days value with a preset selected falls back to the preset', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectReason('spam')
    selectPreset('30')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 30 }),
      expect.anything()
    )
  })

  it('a decimal custom-days value coerces to a rejected (non-integer) input, not a truncated integer', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    selectReason('spam')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '2.9' } })
    // No preset selected — decimal input alone must not enable Confirm.
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('accepts the custom-days cap boundary (3650) and sends it', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectReason('spam')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '3650' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')

    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 3650 }),
      expect.anything()
    )
  })

  it('rejects a custom-days value above the cap (3651) — Confirm stays disabled with no preset', () => {
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={makeMutation()}
      />
    )
    selectReason('spam')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), { target: { value: '3651' } })
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
  })

  it('an above-cap custom-days value with a preset selected falls back to the preset', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectReason('spam')
    selectPreset('7')
    fireEvent.change(screen.getByTestId('suspend-custom-days-input'), {
      target: { value: '99999' },
    })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 7 }),
      expect.anything()
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Confirm submit', () => {
  it('calls mutation.mutate with { target_user_id, duration_days, reason } — no "kind" var', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="author-99"
        mutation={mutation}
      />
    )
    selectPreset('7')
    selectReason('harassment')
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledTimes(1)
    const call = mutation.mutate.mock.calls[0]![0]
    expect(call.target_user_id).toBe('author-99')
    expect(call.duration_days).toBe(7)
    expect(call.reason).toBe('harassment')
    expect('kind' in call).toBe(false)
  })

  it('folds a non-empty custom note into reason as "code: note"', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectPreset('1')
    selectReason('other')
    fireEvent.change(screen.getByTestId('suspend-note-textarea'), {
      target: { value: 'repeated targeted messages' },
    })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'other: repeated targeted messages' }),
      expect.anything()
    )
  })

  it('a whitespace-only custom note falls back to the bare reason code', () => {
    const mutation = makeMutation()
    render(
      <SuspendUserDialog
        open
        onOpenChange={vi.fn()}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectPreset('1')
    selectReason('spam')
    fireEvent.change(screen.getByTestId('suspend-note-textarea'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'spam' }),
      expect.anything()
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Cancel / Esc — no mutation, state resets', () => {
  it('Cancel closes without calling mutate', () => {
    const mutation = makeMutation()
    const onOpenChange = vi.fn()
    render(
      <SuspendUserDialog
        open
        onOpenChange={onOpenChange}
        authorUserId="a1"
        mutation={mutation}
      />
    )
    selectPreset('1')
    selectReason('spam')
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

  it('reopening after Cancel clears duration + reason + note', () => {
    const mutation = makeMutation()
    render(<Harness mutation={mutation} />)
    selectPreset('30')
    selectReason('threats')
    fireEvent.change(screen.getByTestId('suspend-note-textarea'), { target: { value: 'stale' } })
    fireEvent.click(screen.getByTestId('btn-cancel'))

    fireEvent.click(screen.getByTestId('harness-reopen'))

    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByTestId('suspend-note-textarea') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByTestId('suspend-custom-days-input') as HTMLInputElement).value).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('real Confirm → settle flow — stay-open on error, close on success', () => {
  function fillValidForm() {
    selectPreset('7')
    selectReason('spam')
  }

  it('a settled error keeps the dialog OPEN, shows the calm inline error (no leak), and re-enables Confirm', () => {
    render(
      <FlowHarness
        outcome="error"
        mutateSpy={vi.fn()}
      />
    )
    fillValidForm()
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('true')
    expect(screen.getByText("Couldn't complete that. Try again.")).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/22023/)
    expect(screen.getByTestId('btn-confirm').getAttribute('aria-disabled')).toBe('false')
  })

  it('a settled success CLOSES the dialog', () => {
    render(
      <FlowHarness
        outcome="success"
        mutateSpy={vi.fn()}
      />
    )
    fillValidForm()
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(document.querySelector('[data-dialog="true"]')?.getAttribute('data-open')).toBe('false')
  })

  it('re-firing Confirm after an error retries the mutation', () => {
    const mutateSpy = vi.fn()
    render(
      <FlowHarness
        outcome="error"
        mutateSpy={mutateSpy}
      />
    )
    fillValidForm()
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    expect(mutateSpy).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('source-grep guardrails', () => {
  it('SuspendUserDialog.tsx exists', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
  })

  it('does NOT import @legendapp/state (D7 boundary rule)', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
    const src = readFileSync(DIALOG_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('does NOT contain a console.* call with "reason" or "note" in the same expression (NFR19)', () => {
    expect(existsSync(DIALOG_PATH)).toBe(true)
    const src = readFileSync(DIALOG_PATH, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*(reason|note)/i)
  })
})
