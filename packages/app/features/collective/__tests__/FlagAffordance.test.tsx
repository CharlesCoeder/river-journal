// @vitest-environment happy-dom
/**
 * TDD red-phase unit tests for `features/collective/FlagAffordance.tsx`.
 *
 * Red-phase contract: every test MUST fail until Task 3 creates
 * `packages/app/features/collective/FlagAffordance.tsx`.
 *
 * Test coverage:
 *   t1  — trigger renders; null reporterUserId → null
 *   t2  — disabled hides trigger entirely
 *   t3  — opens popover on trigger click; "Report" menu item visible
 *   t4  — opens dialog on Report click; radio list + TextArea visible
 *   t5  — Submit disabled until reason chosen; selecting reason enables it
 *   t6  — Submit fires useReportPost.mutate with correct vars + calls addLocallyHiddenPost;
 *          no console.* called
 *   t7  — empty note submits as null
 *   t8  — Cancel does not mutate or hide; dialog closes
 *   t9  — Submit during isPending is a no-op
 *   t10 — Reduced-motion: animation props undefined on overlay/content
 *   t11 — Source grep: FlagAffordance.tsx has no console.*+note or Sentry+note
 *
 * Mock strategy: vi.mock for useReportPost, addLocallyHiddenPost, @my/ui, @tamagui/lucide-icons.
 * Mirrors ReactionStrip.test.tsx + CollectiveFeedScreen.test.tsx patterns.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constant for grep tests ─────────────────────────────────────────────
const FLAG_AFFORDANCE_PATH = path.resolve(__dirname, '..', 'FlagAffordance.tsx')

// ─── Hoisted spy refs (must be created before vi.mock factories run) ──────────
const { mutateSpy, addLocallyHiddenPostSpy } = vi.hoisted(() => ({
  mutateSpy: vi.fn(),
  addLocallyHiddenPostSpy: vi.fn(),
}))

// ─── Controlled state for mocks ───────────────────────────────────────────────
let reduceMotionValue = false

// ─── useReportPost mock ───────────────────────────────────────────────────────
let mockIsPending = false

vi.mock('app/state/collective/mutations', () => ({
  useReportPost: () => ({
    mutate: mutateSpy,
    isPending: mockIsPending,
    error: null,
  }),
  // useDeleteOwnPost needed by FlagAffordance after prop rename.
  useDeleteOwnPost: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}))

// ─── addLocallyHiddenPost mock ────────────────────────────────────────────────
vi.mock('app/state/store', () => ({
  addLocallyHiddenPost: addLocallyHiddenPostSpy,
  // export other parts of store to satisfy any side-effect imports
  store$: {},
  ensureProfile: vi.fn(),
}))

// ─── useReducedMotion from @my/ui mock ───────────────────────────────────────
// NOTE: @my/ui mock below controls useReducedMotion via reduceMotionValue closure.

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  return {
    View: ({
      children,
      tag,
      onPress,
      'aria-label': ariaLabel,
      'aria-haspopup': ariaHasPopup,
      role,
      opacity,
      pointerEvents,
      ...props
    }: any) => {
      const htmlProps: Record<string, unknown> = {}
      if (ariaLabel) htmlProps['aria-label'] = ariaLabel
      if (ariaHasPopup) htmlProps['aria-haspopup'] = ariaHasPopup
      if (role) htmlProps['role'] = role
      if (onPress) {
        htmlProps['onClick'] = onPress
        htmlProps['onKeyDown'] = (e: any) => {
          if (e.key === ' ' || e.key === 'Enter') onPress()
        }
      }
      // Track animation prop for reduced-motion assertions
      if (props.animation !== undefined) htmlProps['data-animation'] = props.animation ?? ''
      const elementTag = tag === 'button' ? 'button' : 'div'
      return ReactModule.createElement(elementTag, htmlProps, children)
    },

    Text: ({ children, ...props }: any) => ReactModule.createElement('span', {}, children),

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),

    // Popover — when open, render children; Trigger renders trigger, Content renders content
    Popover: ({ children, open, onOpenChange, placement }: any) =>
      ReactModule.createElement(
        'div',
        { 'data-popover': 'true', 'data-open': String(open) },
        children
      ),

    // Forward Popover sub-components
    // We use a factory that also attaches sub-components below

    Dialog: ({ children, open, onOpenChange, modal }: any) =>
      ReactModule.createElement(
        'div',
        {
          'data-dialog': 'true',
          'data-open': String(open),
          role: open ? 'dialog' : undefined,
        },
        open ? children : null
      ),

    RadioGroup: ({ children, value, onValueChange, required }: any) =>
      ReactModule.createElement(
        'div',
        {
          role: 'radiogroup',
          'data-value': value ?? '',
          'data-required': required ? 'true' : undefined,
          onChange: (e: any) => onValueChange?.(e.target.value),
        },
        children
      ),

    Label: ({ children, htmlFor, ...props }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),

    TextArea: ({ value, onChangeText, placeholder, maxLength, ...props }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        maxLength,
        'data-testid': 'report-note-textarea',
      }),

    ExpandingLineButton: ({
      children,
      onPress,
      disabled,
      'aria-disabled': ariaDisabled,
      ...props
    }: any) => {
      const isDisabled = disabled || ariaDisabled === 'true' || ariaDisabled === true
      return ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!isDisabled,
          'aria-disabled': isDisabled ? 'true' : 'false',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      )
    },

    Anchor: ({ children, href, ...props }: any) =>
      ReactModule.createElement('a', { href }, children),

    useReducedMotion: () => reduceMotionValue,
  }
})

// ─── Popover sub-components — patched onto @my/ui mock after factory ─────────
// We hook into the module after import to attach .Trigger, .Content, etc.
// Actually, we do this inline in the mock above by creating wrapper components.
// Since vi.mock hoisting prevents us from doing post-import patching cleanly,
// we implement the full structure inline:

// Patch via vi.mock with nested objects:
vi.mock('@my/ui', async (importOriginal) => {
  const ReactModule = await import('react')

  const makeElement =
    (tag: string) =>
    ({ children, ...props }: any) =>
      ReactModule.createElement(tag, props, children)

  // Popover sub-components
  const PopoverTrigger = ({ children, asChild }: any) =>
    ReactModule.createElement('div', { 'data-popover-trigger': 'true' }, children)

  const PopoverContent = ({
    children,
    open: _open,
    padding,
    backgroundColor,
    borderColor,
    borderWidth,
    elevate,
    ...props
  }: any) =>
    ReactModule.createElement('div', { 'data-popover-content': 'true', role: 'menu' }, children)

  // Dialog sub-components
  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)

  const DialogOverlay = ({ animation, ...props }: any) =>
    ReactModule.createElement('div', {
      'data-dialog-overlay': 'true',
      'data-animation': animation ?? '',
    })

  const DialogContent = ({ children, animation, ...props }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog-content': 'true',
        'data-animation': animation ?? '',
      },
      children
    )

  const DialogTitle = ({ children, ...props }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)

  const DialogDescription = ({ children, ...props }: any) =>
    ReactModule.createElement('p', { 'data-dialog-desc': 'true' }, children)

  // RadioGroup sub-components
  const RadioGroupItem = ({ children, value, id, ...props }: any) =>
    ReactModule.createElement(
      'input',
      {
        type: 'radio',
        id,
        value,
        'data-radio-item': 'true',
        onChange: (e: any) => {
          // bubble up — parent RadioGroup handles value change
        },
      },
      children
    )

  const RadioGroupIndicator = (props: any) =>
    ReactModule.createElement('span', { 'data-radio-indicator': 'true' })

  // Compose Popover component
  const PopoverComponent = ({ children, open, onOpenChange, placement }: any) =>
    ReactModule.createElement(
      'div',
      { 'data-popover': 'true', 'data-open': String(open) },
      children
    )

  Object.assign(PopoverComponent, {
    Trigger: PopoverTrigger,
    Content: PopoverContent,
  })

  // Compose Dialog component
  const DialogComponent = ({ children, open, onOpenChange, modal }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog': 'true',
        'data-open': String(open),
        role: open ? 'dialog' : undefined,
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

  // Compose RadioGroup component
  const RadioGroupComponent = ({ children, value, onValueChange, required }: any) =>
    ReactModule.createElement(
      'div',
      {
        role: 'radiogroup',
        'data-rg-value': value ?? '',
        onClick: (e: any) => {
          // Clicks on radio inputs inside bubble up here — intercept radio changes
          const target = e.target as HTMLInputElement
          if (target.type === 'radio') {
            onValueChange?.(target.value)
          }
        },
      },
      children
    )

  Object.assign(RadioGroupComponent, {
    Item: RadioGroupItem,
    Indicator: RadioGroupIndicator,
  })

  return {
    View: ({
      children,
      tag,
      onPress,
      'aria-label': ariaLabel,
      'aria-haspopup': ariaHasPopup,
      role,
      opacity,
      pointerEvents,
      ...props
    }: any) => {
      const htmlProps: Record<string, unknown> = {}
      if (ariaLabel) htmlProps['aria-label'] = ariaLabel
      if (ariaHasPopup) htmlProps['aria-haspopup'] = ariaHasPopup
      if (role) htmlProps['role'] = role
      if (onPress) {
        htmlProps['onClick'] = onPress
        htmlProps['onKeyDown'] = (e: any) => {
          if (e.key === ' ' || e.key === 'Enter') onPress()
        }
      }
      if (props.animation !== undefined) htmlProps['data-animation'] = props.animation ?? ''
      const elementTag = tag === 'button' ? 'button' : 'div'
      return ReactModule.createElement(elementTag, htmlProps, children)
    },

    Text: ({ children, ...props }: any) => ReactModule.createElement('span', {}, children),

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),

    Popover: PopoverComponent,

    Dialog: DialogComponent,

    RadioGroup: RadioGroupComponent,

    Label: ({ children, htmlFor, ...props }: any) =>
      ReactModule.createElement('label', { htmlFor }, children),

    TextArea: ({ value, onChangeText, placeholder, maxLength, ...props }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
        placeholder,
        maxLength,
        'data-testid': 'report-note-textarea',
      }),

    ExpandingLineButton: ({
      children,
      onPress,
      disabled,
      'aria-disabled': ariaDisabled,
      ...props
    }: any) => {
      const isDisabled = disabled || ariaDisabled === 'true' || ariaDisabled === true
      return ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!isDisabled,
          'aria-disabled': isDisabled ? 'true' : 'false',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      )
    },

    Anchor: ({ children, href, ...props }: any) =>
      ReactModule.createElement('a', { href }, children),

    useReducedMotion: () => reduceMotionValue,
  }
})

// ─── @tamagui/lucide-icons mock ───────────────────────────────────────────────
vi.mock('@tamagui/lucide-icons', () => ({
  MoreHorizontal: ({ size, ...props }: any) =>
    React.createElement('span', { 'data-icon': 'MoreHorizontal', 'data-size': size, ...props }),
}))

// ─── BlockUserConfirmDialog mock — captures the props it was mounted with ─────
// FlagAffordance renders this as a sibling controlled dialog (mirroring the
// report/delete dialogs). The mock never renders real dialog markup; tests
// assert on the captured props + open/close calls instead.
const blockDialogPropsCalls: any[] = []
vi.mock('../BlockUserConfirmDialog', () => ({
  BlockUserConfirmDialog: (props: any) => {
    blockDialogPropsCalls.push(props)
    return React.createElement('div', {
      'data-testid': 'block-user-confirm-dialog',
      'data-open': String(props.open),
      'data-blocker': props.blockerUserId ?? '',
      'data-blocked': props.blockedUserId ?? '',
    })
  },
}))

// ─── Import under test — will fail until FlagAffordance.tsx exists ────────────
import { FlagAffordance } from '../FlagAffordance'

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup()
  mutateSpy.mockReset()
  addLocallyHiddenPostSpy.mockReset()
  reduceMotionValue = false
  mockIsPending = false
  blockDialogPropsCalls.length = 0
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — trigger renders; null reporterUserId renders nothing
// ─────────────────────────────────────────────────────────────────────────────

describe('t1 — trigger renders', () => {
  it('renders a button with aria-label="Report this post" when canReport=true (only-report case)', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    expect(trigger).not.toBeNull()
  })

  it('renders nothing (null) when reporterUserId is null', () => {
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: null,
        canReport: true,
        canSelfDelete: false,
      })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the MoreHorizontal icon inside the trigger', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const icon = document.querySelector('[data-icon="MoreHorizontal"]')
    expect(icon).not.toBeNull()
  })

  it('trigger has aria-haspopup="menu"', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — disabled hides trigger entirely
// ─────────────────────────────────────────────────────────────────────────────

describe('t2 — disabled renders nothing', () => {
  it('returns null when disabled===true', () => {
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: false,
        canSelfDelete: false,
      })
    )
    expect(container.firstChild).toBeNull()
  })

  it('no button present when disabled===true', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: false,
        canSelfDelete: false,
      })
    )
    expect(screen.queryByRole('button', { name: /report this post/i })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — opens popover on trigger click; "Report" menu item is visible
// ─────────────────────────────────────────────────────────────────────────────

describe('t3 — popover opens on trigger click', () => {
  it('clicking the trigger opens the popover (Popover becomes data-open="true")', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    fireEvent.click(trigger)

    const popover = document.querySelector('[data-popover="true"]')
    expect(popover?.getAttribute('data-open')).toBe('true')
  })

  it('"Report" menu item is visible after popover opens', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    fireEvent.click(trigger)

    expect(screen.getByText('Report')).not.toBeNull()
  })

  it('"Report" menu item has role="menuitem"', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    fireEvent.click(trigger)

    const menuItem = screen.getByRole('menuitem', { name: /report/i })
    expect(menuItem).not.toBeNull()
  })

  it('Delete menu item is present in source', () => {
    // The TODO placeholder was replaced by the real Delete menu item.
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    // Verify the Delete menu item code is present (canSelfDelete conditional)
    expect(src).toMatch(/canSelfDelete/)
    // Verify the TODO placeholder is gone
    expect(src).not.toMatch(/TODO\(Story \d/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — clicking "Report" opens dialog; radio list and TextArea visible
// ─────────────────────────────────────────────────────────────────────────────

describe('t4 — dialog opens with radio list + TextArea', () => {
  function openDialog() {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    fireEvent.click(trigger)
    const reportItem = screen.getByRole('menuitem', { name: /report/i })
    fireEvent.click(reportItem)
  }

  it('dialog is open after clicking "Report" menu item', () => {
    openDialog()
    const dialog = document.querySelector('[data-dialog="true"]')
    expect(dialog?.getAttribute('data-open')).toBe('true')
  })

  it('dialog title "Report this post" is visible', () => {
    openDialog()
    expect(screen.getByText(/Report this post/i)).not.toBeNull()
  })

  it('all 4 reason radio buttons are present', () => {
    openDialog()
    // Labels for each reason should be visible
    expect(screen.getByText('Harassment')).not.toBeNull()
    expect(screen.getByText('Off-topic')).not.toBeNull()
    expect(screen.getByText('Spam')).not.toBeNull()
    expect(screen.getByText('Other')).not.toBeNull()
  })

  it('TextArea for optional note is present', () => {
    openDialog()
    const textarea = document.querySelector('[data-testid="report-note-textarea"]')
    expect(textarea).not.toBeNull()
  })

  it('TextArea has placeholder "Add a note (optional)"', () => {
    openDialog()
    const textarea = document.querySelector('[data-testid="report-note-textarea"]')
    expect(textarea?.getAttribute('placeholder')).toBe('Add a note (optional)')
  })

  it('TextArea has maxLength=500', () => {
    openDialog()
    const textarea = document.querySelector('[data-testid="report-note-textarea"]')
    expect(Number(textarea?.getAttribute('maxlength'))).toBe(500)
  })

  it('disclosure copy is visible ("community guidelines")', () => {
    openDialog()
    expect(screen.getByText(/community guidelines/i)).not.toBeNull()
  })

  it('Submit and Cancel buttons are present', () => {
    openDialog()
    expect(screen.getByTestId('btn-submit')).not.toBeNull()
    expect(screen.getByTestId('btn-cancel')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — Submit disabled until reason chosen; selecting reason enables it
// ─────────────────────────────────────────────────────────────────────────────

describe('t5 — Submit enabled only after reason selected', () => {
  function openDialog() {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p1',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    const trigger = screen.getByRole('button', { name: /report this post/i })
    fireEvent.click(trigger)
    const reportItem = screen.getByRole('menuitem', { name: /report/i })
    fireEvent.click(reportItem)
  }

  it('Submit button is aria-disabled="true" when no reason is selected', () => {
    openDialog()
    const submitBtn = screen.getByTestId('btn-submit')
    expect(
      submitBtn.getAttribute('aria-disabled') === 'true' ||
        (submitBtn as HTMLButtonElement).disabled === true
    ).toBe(true)
  })

  it('Submit button is enabled after selecting a reason', () => {
    openDialog()
    // Click the "Spam" radio
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    expect(spamRadio).not.toBeNull()
    fireEvent.click(spamRadio)

    const submitBtn = screen.getByTestId('btn-submit')
    // After selection, submit should NOT be disabled
    expect(
      submitBtn.getAttribute('aria-disabled') === 'false' ||
        (submitBtn as HTMLButtonElement).disabled === false
    ).toBe(true)
  })

  it('reason radio group renders reasons in defined order: Harassment, Off-topic, Spam, Other', () => {
    openDialog()
    const radios = document.querySelectorAll('input[type="radio"]')
    const values = Array.from(radios).map((r) => (r as HTMLInputElement).value)
    expect(values).toEqual(['harassment', 'off_topic', 'spam', 'other'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — Submit fires useReportPost.mutate with correct vars; adds to local-hide set;
//      no console.* called during submit
// ─────────────────────────────────────────────────────────────────────────────

describe('t6 — Submit fires mutation + local-hide; no console', () => {
  beforeEach(() => {
    // Spy on console methods — must not be called
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mutate called once with correct vars on submit', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-submit',
        reporterUserId: 'u-reporter',
        canReport: true,
        canSelfDelete: false,
      })
    )
    // Open popover
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    // Click Report
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    // Select "Spam" reason
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)

    // Type a note
    const textarea = document.querySelector(
      '[data-testid="report-note-textarea"]'
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })

    // Submit
    const submitBtn = screen.getByTestId('btn-submit')
    fireEvent.click(submitBtn)

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    const callArgs = mutateSpy.mock.calls[0]![0]
    expect(callArgs.post_id).toBe('p-submit')
    expect(callArgs.reporter_user_id).toBe('u-reporter')
    expect(callArgs.reason_code).toBe('spam')
    expect(callArgs.note).toBe('hello')
    // id must be a valid UUID
    expect(callArgs.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('addLocallyHiddenPost called once with postId on submit', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-submit',
        reporterUserId: 'u-reporter',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    const submitBtn = screen.getByTestId('btn-submit')
    fireEvent.click(submitBtn)

    expect(addLocallyHiddenPostSpy).toHaveBeenCalledTimes(1)
    expect(addLocallyHiddenPostSpy).toHaveBeenCalledWith('p-submit')
  })

  it('addLocallyHiddenPost is called synchronously after mutate (not in onSuccess)', () => {
    // Both should be called in the same synchronous submit handler
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-sync',
        reporterUserId: 'u-reporter',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    const submitBtn = screen.getByTestId('btn-submit')
    fireEvent.click(submitBtn)

    // Both called in same tick — mutate called before addLocallyHiddenPost
    const mutateOrder = mutateSpy.mock.invocationCallOrder[0]!
    const hideOrder = addLocallyHiddenPostSpy.mock.invocationCallOrder[0]!
    expect(mutateOrder).toBeLessThan(hideOrder)
  })

  it('console.log NOT called during submit', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-nfr',
        reporterUserId: 'u-reporter',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    fireEvent.change(
      document.querySelector('[data-testid="report-note-textarea"]') as HTMLTextAreaElement,
      { target: { value: 'sensitive note' } }
    )
    fireEvent.click(screen.getByTestId('btn-submit'))

    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('dialog closes after submit', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-close',
        reporterUserId: 'u-reporter',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    fireEvent.click(screen.getByTestId('btn-submit'))

    const dialog = document.querySelector('[data-dialog="true"]')
    expect(dialog?.getAttribute('data-open')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — empty note submits as null
// ─────────────────────────────────────────────────────────────────────────────

describe('t7 — empty note submits as null', () => {
  it('mutate called with note: null when TextArea is empty', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-nonote',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    // Do NOT type anything in the TextArea
    fireEvent.click(screen.getByTestId('btn-submit'))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    const callArgs = mutateSpy.mock.calls[0]![0]
    expect(callArgs.note).toBeNull()
  })

  it('mutate called with note: null when note is only whitespace', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-whitespace',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    fireEvent.change(
      document.querySelector('[data-testid="report-note-textarea"]') as HTMLTextAreaElement,
      { target: { value: '   ' } }
    )
    fireEvent.click(screen.getByTestId('btn-submit'))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    const callArgs = mutateSpy.mock.calls[0]![0]
    expect(callArgs.note).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — Cancel does not mutate or hide; dialog closes
// ─────────────────────────────────────────────────────────────────────────────

describe('t8 — Cancel closes dialog without mutation', () => {
  it('mutate NOT called when Cancel is tapped', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-cancel',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    fireEvent.click(screen.getByTestId('btn-cancel'))

    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('addLocallyHiddenPost NOT called when Cancel is tapped', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-cancel',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    fireEvent.click(screen.getByTestId('btn-cancel'))

    expect(addLocallyHiddenPostSpy).not.toHaveBeenCalled()
  })

  it('dialog closes after Cancel', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-cancel',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))
    fireEvent.click(screen.getByTestId('btn-cancel'))

    const dialog = document.querySelector('[data-dialog="true"]')
    expect(dialog?.getAttribute('data-open')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — Submit during isPending is a no-op (double-submit guard)
// ─────────────────────────────────────────────────────────────────────────────

describe('t9 — Submit disabled during isPending', () => {
  it('mutate NOT called when Submit is tapped while isPending===true', () => {
    mockIsPending = true
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-pending',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    fireEvent.click(screen.getByTestId('btn-submit'))

    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('Submit button is aria-disabled="true" when isPending===true', () => {
    mockIsPending = true
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-pending2',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)

    const submitBtn = screen.getByTestId('btn-submit')
    expect(
      submitBtn.getAttribute('aria-disabled') === 'true' ||
        (submitBtn as HTMLButtonElement).disabled === true
    ).toBe(true)
  })

  it('Submit button label stays "Submit" (no text swap) during isPending', () => {
    mockIsPending = true
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-pending3',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    expect(screen.getByTestId('btn-submit').textContent).toBe('Submit')
    // No "Submitting" or spinner text
    expect(screen.queryByText(/Submitting/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t10 — Reduced-motion: animation prop undefined on overlay/content
// ─────────────────────────────────────────────────────────────────────────────

describe('t10 — reduced-motion animation degradation', () => {
  it('Dialog overlay animation is undefined/empty when useReducedMotion returns true', () => {
    reduceMotionValue = true
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-rm',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    // Dialog overlay should have no "quick" animation token
    const overlay = document.querySelector('[data-dialog-overlay="true"]')
    const animVal = overlay?.getAttribute('data-animation')
    expect(animVal === '' || animVal === undefined || animVal === null).toBe(true)
  })

  it('Dialog content animation is undefined/empty when useReducedMotion returns true', () => {
    reduceMotionValue = true
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-rm2',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    const content = document.querySelector('[data-dialog-content="true"]')
    const animVal = content?.getAttribute('data-animation')
    expect(animVal === '' || animVal === undefined || animVal === null).toBe(true)
  })

  it('Dialog uses "quick" animation token when reduced motion is OFF', () => {
    reduceMotionValue = false
    render(
      React.createElement(FlagAffordance, {
        postId: 'p-anim',
        reporterUserId: 'u1',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /report/i }))

    const overlay = document.querySelector('[data-dialog-overlay="true"]')
    const animVal = overlay?.getAttribute('data-animation')
    // When motion is allowed, the animation token should be 'quick'
    expect(animVal).toBe('quick')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — Source grep: no console.*+note or Sentry+note
// ─────────────────────────────────────────────────────────────────────────────

describe('t11 — telemetry guard source grep', () => {
  it('FlagAffordance.tsx file exists on disk', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
  })

  it('FlagAffordance.tsx does NOT contain console.* call with "note" in same expression', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*note/)
  })

  it('FlagAffordance.tsx does NOT contain Sentry reference alongside "note"', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    expect(src).not.toMatch(/Sentry[\s\S]{0,200}note/)
  })

  it('FlagAffordance.tsx does NOT import @legendapp/state (D7 boundary rule)', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
  })

  it('FlagAffordance.tsx has TODO marker for onLongPress deferral', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    expect(src).toMatch(/TODO\(post-3-12\).*onLongPress|onLongPress.*TODO\(post-3-12\)/i)
  })

  it('FlagAffordance.tsx does NOT contain "quickFade" animation token (use "quick" only)', () => {
    expect(existsSync(FLAG_AFFORDANCE_PATH)).toBe(true)
    const src = readFileSync(FLAG_AFFORDANCE_PATH, 'utf8')
    expect(src).not.toMatch(/quickFade/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — Focus menu item: canFocus=true renders Focus item; tap calls onFocus
// ─────────────────────────────────────────────────────────────────────────────

describe('t12 — Focus menu item renders and fires onFocus', () => {
  it('renders Focus item in menu when canFocus=true', () => {
    const onFocusSpy = vi.fn()
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'post-focus-test',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canFocus: true,
        onFocus: onFocusSpy,
      })
    )

    // Open the menu
    const trigger =
      container.querySelector('[data-popover-trigger] button, button[aria-haspopup="menu"]') ||
      container.querySelector('button')
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger!)

    // Focus item should be in the menu
    const focusItem = screen.getByText('Focus')
    expect(focusItem).toBeTruthy()
  })

  it('calls onFocus when Focus menu item is tapped', () => {
    const onFocusSpy = vi.fn()
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'post-focus-test-2',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canFocus: true,
        onFocus: onFocusSpy,
      })
    )

    // Open the menu
    const trigger = container.querySelector('button')
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger!)

    // Tap the Focus item
    const focusItem = screen.getByText('Focus')
    fireEvent.click(focusItem)

    expect(onFocusSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT render Focus item when canFocus=false (default)', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-no-focus',
        reporterUserId: 'user-abc',
        canReport: true,
        canSelfDelete: false,
        canFocus: false,
      })
    )

    expect(screen.queryByText('Focus')).toBeNull()
  })

  it('renders nothing when canFocus=false and canReport=false and canSelfDelete=false', () => {
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'post-empty',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canFocus: false,
      })
    )

    // No button should render (early return: nothing to show)
    expect(container.querySelector('button')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — "Block this user" menu item: visibility, sibling-of-Report placement,
//        opens BlockUserConfirmDialog with the right author id
// ─────────────────────────────────────────────────────────────────────────────

describe('t13 — "Block this user" menu item renders only when canBlock', () => {
  it('renders the "Block this user" menuitem when canBlock=true', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-1',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-1',
      })
    )
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('menuitem', { name: /block this user/i })).toBeTruthy()
  })

  it('does NOT render "Block this user" when canBlock=false (default)', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-1',
        reporterUserId: 'user-abc',
        canReport: true,
        canSelfDelete: false,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /report this post/i }))

    expect(screen.queryByText('Block this user')).toBeNull()
  })

  it('never renders "Block this user" for the viewer\'s own post — canBlock is computed false by the mount site, so the trigger itself must not even render when it is the only flag', () => {
    // Mount sites compute canBlock false for own posts; verify FlagAffordance
    // renders nothing when that is the ONLY flag supplied (own-post case, all
    // other flags also false because the viewer can't report/delete via this path either).
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'post-own',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canBlock: false,
      })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the trigger (not null) when canBlock=true is the ONLY true flag', () => {
    const { container } = render(
      React.createElement(FlagAffordance, {
        postId: 'post-only-block',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canFocus: false,
        canBlock: true,
        blockAuthorUserId: 'author-2',
      })
    )
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('button')).not.toBeNull()
  })
})

describe('t13 — "Block this user" is a sibling of "Report", not nested under it', () => {
  it('both "Report" and "Block this user" render simultaneously when canReport AND canBlock are true', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-both',
        reporterUserId: 'user-abc',
        canReport: true,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-3',
      })
    )
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('menuitem', { name: /^report$/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /block this user/i })).toBeTruthy()
  })

  it('"Block this user" has role="menuitem" (same affordance level as Report/Delete, not a submenu)', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-role',
        reporterUserId: 'user-abc',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-4',
      })
    )
    fireEvent.click(screen.getByRole('button'))

    const item = screen.getByText('Block this user')
    expect(item.closest('[role="menuitem"]')).toBeTruthy()
  })
})

describe('t13 — tapping "Block this user" closes the menu and opens BlockUserConfirmDialog with the right author id', () => {
  it('opens the block dialog (data-open="true") after tapping the menu item', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-open',
        reporterUserId: 'user-current',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-open',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /block this user/i }))

    const dialog = screen.getByTestId('block-user-confirm-dialog')
    expect(dialog.getAttribute('data-open')).toBe('true')
  })

  it('closes the popover menu when the block dialog opens', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-close-menu',
        reporterUserId: 'user-current',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-close',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /block this user/i }))

    const popover = document.querySelector('[data-popover="true"]')
    expect(popover?.getAttribute('data-open')).toBe('false')
  })

  it('passes blockerUserId === reporterUserId (the current user) to the dialog', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-blocker-id',
        reporterUserId: 'user-current-viewer',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-target',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /block this user/i }))

    const dialog = screen.getByTestId('block-user-confirm-dialog')
    expect(dialog.getAttribute('data-blocker')).toBe('user-current-viewer')
  })

  it('passes blockedUserId === blockAuthorUserId (the post author, NOT the postId) to the dialog', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-not-the-author-id',
        reporterUserId: 'user-current-viewer',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-target-id',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /block this user/i }))

    const dialog = screen.getByTestId('block-user-confirm-dialog')
    expect(dialog.getAttribute('data-blocked')).toBe('author-target-id')
    expect(dialog.getAttribute('data-blocked')).not.toBe('post-not-the-author-id')
  })

  it('the dialog is mounted (present in the tree) even before it is opened — controlled sibling, not a lazy trigger', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-mounted',
        reporterUserId: 'user-current',
        canReport: false,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-mounted',
      })
    )
    // Before any interaction, the dialog component is already in the tree with open=false.
    const dialog = screen.getByTestId('block-user-confirm-dialog')
    expect(dialog.getAttribute('data-open')).toBe('false')
  })
})

describe('t13 — existing Report/Delete flows are unbroken by the Block addition', () => {
  it('Report still opens its own dialog independent of the block dialog', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-report-still-works',
        reporterUserId: 'user-current',
        canReport: true,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-x',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /^report$/i }))

    const reportDialogs = document.querySelectorAll('[data-dialog="true"][data-open="true"]')
    expect(reportDialogs.length).toBe(1)
    // The block dialog (mocked) must remain closed.
    expect(screen.getByTestId('block-user-confirm-dialog').getAttribute('data-open')).toBe('false')
  })

  it('Submit still fires useReportPost.mutate with correct vars when canBlock is also true', () => {
    render(
      React.createElement(FlagAffordance, {
        postId: 'post-report-mutate',
        reporterUserId: 'user-reporter',
        canReport: true,
        canSelfDelete: false,
        canBlock: true,
        blockAuthorUserId: 'author-y',
      })
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: /^report$/i }))
    const spamRadio = document.querySelector(
      'input[type="radio"][value="spam"]'
    ) as HTMLInputElement
    fireEvent.click(spamRadio)
    fireEvent.click(screen.getByTestId('btn-submit'))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy.mock.calls[0]![0].post_id).toBe('post-report-mutate')
  })
})
