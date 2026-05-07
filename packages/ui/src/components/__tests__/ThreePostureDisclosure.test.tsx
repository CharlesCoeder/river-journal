// @vitest-environment happy-dom
// ThreePostureDisclosure primitive — RED-PHASE TDD
// ALL tests in this file MUST FAIL before implementation of
// packages/ui/src/components/ThreePostureDisclosure.tsx.
//
// Story 3-6 ACs covered: 1, 2, 3, 4, 5, 6, 7, 8
//
// Test framework: Vitest + React Testing Library
// Dialog mock: mirrors JournalScreen.exitConfirm.test.tsx:117 pattern

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies used in vi.mock() factories
// ─────────────────────────────────────────────────────────────────────────────
const { useReducedMotionMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn(() => false),
}))

// ─── Mock useReducedMotion (same-package, imported as relative in primitive) ──
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: useReducedMotionMock,
}))

// ─── Mock tamagui — Dialog + layout primitives → semantic HTML ───────────────
//
// Mirrors the JournalScreen.exitConfirm.test.tsx:117 Dialog mock pattern.
// Dialog.Content surfaces `data-transition` so AC #6 (reduced-motion) is
// assertable without inspecting Tamagui internals.
vi.mock('tamagui', () => {
  const ReactModule = require('react')

  const Dialog = ({ children, open, onOpenChange, dismissOnOverlayPress, disableEscapeKey }: any) => {
    if (!open) return null
    return ReactModule.createElement(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'data-dismiss-on-overlay-press': String(dismissOnOverlayPress ?? true),
        'data-disable-escape-key': String(disableEscapeKey ?? false),
      },
      // Simulate overlay press by exposing a data-testid="dialog-overlay" element
      // that fires onOpenChange(false) when dismissOnOverlayPress is true.
      ReactModule.createElement('div', {
        'data-testid': 'dialog-overlay',
        onClick: () => {
          if (dismissOnOverlayPress !== false) {
            onOpenChange?.(false)
          }
        },
      }),
      children
    )
  }

  Dialog.Portal = ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children)

  Dialog.Overlay = ({ onPress, ...rest }: any) =>
    ReactModule.createElement('div', {
      'data-testid': 'dialog-overlay-inner',
      onClick: onPress,
      ...rest,
    })

  Dialog.Content = ({ children, transition, 'aria-labelledby': ariaLabelledBy, ...rest }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-testid': 'dialog-content',
        'data-transition': transition,
        'aria-labelledby': ariaLabelledBy,
        ...rest,
      },
      children
    )

  Dialog.Title = ({ children, id, ...rest }: any) =>
    ReactModule.createElement('h2', { 'data-testid': 'dialog-title', id, ...rest }, children)

  Dialog.Description = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-testid': 'dialog-description' }, children)

  Dialog.Close = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  // YStack / XStack / Text / View / Button / Stack → semantic HTML pass-throughs
  const passthrough = (tagName: string) => {
    const Component = ({ children, tag, accessibilityRole, role, ...rest }: any) =>
      ReactModule.createElement(
        tag ?? tagName,
        {
          role: accessibilityRole ?? role,
          ...rest,
        },
        children
      )
    Component.displayName = tagName
    return Component
  }

  // ExpandingLineButton → <button>
  const ExpandingLineButton = ({ children, onPress, size, ...rest }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        'data-size': size,
        onClick: onPress,
        ...rest,
      },
      children
    )

  return {
    Dialog,
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    Text: passthrough('span'),
    View: passthrough('div'),
    Button: passthrough('button'),
    Stack: passthrough('div'),
  }
})

// ─── Mock ExpandingLineButton from @my/ui (if imported from there) ───────────
// The primitive imports from tamagui only; ExpandingLineButton comes from
// same package. We stub it here so if the primitive imports it from within
// the same package (via a local path), the tamagui mock above is not needed.
// This is a belt-and-suspenders stub.
vi.mock('../ExpandingLineButton', () => {
  const ReactModule = require('react')
  return {
    ExpandingLineButton: ({ children, onPress, size, ...rest }: any) =>
      ReactModule.createElement(
        'button',
        { type: 'button', 'data-size': size, onClick: onPress, ...rest },
        children
      ),
  }
})

// ─── Import under test ───────────────────────────────────────────────────────
// This import WILL FAIL (module doesn't exist yet) until the primitive is implemented.
// That failure IS the red-phase signal.
import {
  ThreePostureDisclosure,
} from '../ThreePostureDisclosure'

// ─────────────────────────────────────────────────────────────────────────────
// Shared props factory
// ─────────────────────────────────────────────────────────────────────────────
function makeProps(overrides: Partial<React.ComponentProps<typeof ThreePostureDisclosure>> = {}) {
  return {
    boundary: 'collective_post_v1' as const,
    mode: 'first-time' as const,
    open: true,
    onAcknowledge: vi.fn(),
    onRequestClose: vi.fn(),
    onViewGuidelines: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  useReducedMotionMock.mockReturnValue(false)
})

// =============================================================================
// AC #3: Boundary B renders nothing
// =============================================================================

describe('AC3 — boundary=ai_cloud_v1 renders null regardless of open', () => {
  it('renders nothing when boundary is ai_cloud_v1 and open=true', () => {
    const props = makeProps({ boundary: 'ai_cloud_v1', open: true })
    const { container } = render(React.createElement(ThreePostureDisclosure, props))
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when boundary is ai_cloud_v1 and open=false', () => {
    const props = makeProps({ boundary: 'ai_cloud_v1', open: false })
    const { container } = render(React.createElement(ThreePostureDisclosure, props))
    expect(container.firstChild).toBeNull()
  })
})

// =============================================================================
// AC #4: Boundary A first-time mode — dialog structure and copy
// =============================================================================

describe('AC4 — boundary=collective_post_v1, mode=first-time — full-screen dialog', () => {
  it('renders a dialog element with role="dialog" and aria-modal="true"', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('renders the exact verbatim body copy string', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    expect(
      screen.getByText(
        'Posts in the Collective are visible to other members. Your journal entries stay private and encrypted.'
      )
    ).toBeTruthy()
  })

  it('renders the heading "Posts are public"', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    expect(screen.getByText('Posts are public')).toBeTruthy()
  })

  it('renders a "View community guidelines" link with accessibilityRole="link"', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    const link = screen.getByRole('link', { name: /view community guidelines/i })
    expect(link).toBeTruthy()
  })

  it('renders the acknowledge button labeled "Got it, post"', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    const btn = screen.getByRole('button', { name: /got it, post/i })
    expect(btn).toBeTruthy()
  })

  it('calls onAcknowledge when the acknowledge button is pressed', () => {
    const onAcknowledge = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeProps({ onAcknowledge })))
    const btn = screen.getByRole('button', { name: /got it, post/i })
    fireEvent.click(btn)
    expect(onAcknowledge).toHaveBeenCalledOnce()
  })

  it('calls onViewGuidelines when the guidelines link is pressed', () => {
    const onViewGuidelines = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeProps({ onViewGuidelines })))
    const link = screen.getByRole('link', { name: /view community guidelines/i })
    fireEvent.click(link)
    expect(onViewGuidelines).toHaveBeenCalledOnce()
  })

  it('does NOT render the dialog when open=false', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps({ open: false })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// =============================================================================
// AC #4: mode='review' — button label is "Close", onRequestClose on press
// =============================================================================

describe('AC4 / AC12 — mode=review', () => {
  it('renders button labeled "Close" in review mode (not "Got it, post")', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps({ mode: 'review' })))
    expect(screen.queryByRole('button', { name: /got it, post/i })).toBeNull()
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy()
  })

  it('calls onRequestClose when the close button is pressed in review mode', () => {
    const onRequestClose = vi.fn()
    render(React.createElement(ThreePostureDisclosure, makeProps({ mode: 'review', onRequestClose })))
    const btn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(btn)
    expect(onRequestClose).toHaveBeenCalledOnce()
  })

  it('does NOT call onAcknowledge when review close button is pressed', () => {
    const onAcknowledge = vi.fn()
    const onRequestClose = vi.fn()
    render(
      React.createElement(
        ThreePostureDisclosure,
        makeProps({ mode: 'review', onAcknowledge, onRequestClose })
      )
    )
    const btn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(btn)
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})

// =============================================================================
// AC #4: Tap-outside-dismiss — disabled in first-time, enabled in review
// =============================================================================

describe('AC4 — tap-outside-dismiss behavior', () => {
  it('first-time mode: clicking dialog overlay does NOT call onAcknowledge or onRequestClose', () => {
    const onAcknowledge = vi.fn()
    const onRequestClose = vi.fn()
    render(
      React.createElement(
        ThreePostureDisclosure,
        makeProps({ mode: 'first-time', onAcknowledge, onRequestClose })
      )
    )
    // The Dialog root element should have dismissOnOverlayPress=false in first-time
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-dismiss-on-overlay-press')).toBe('false')
    // Simulate overlay click — must not trigger either callback
    const overlay = screen.getByTestId('dialog-overlay')
    fireEvent.click(overlay)
    expect(onAcknowledge).not.toHaveBeenCalled()
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it('review mode: clicking dialog overlay DOES call onRequestClose', () => {
    const onRequestClose = vi.fn()
    render(
      React.createElement(
        ThreePostureDisclosure,
        makeProps({ mode: 'review', onRequestClose })
      )
    )
    // The Dialog root element should have dismissOnOverlayPress=true in review
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-dismiss-on-overlay-press')).toBe('true')
    const overlay = screen.getByTestId('dialog-overlay')
    fireEvent.click(overlay)
    expect(onRequestClose).toHaveBeenCalledOnce()
  })

  it('first-time mode: disableEscapeKey attribute is true', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps({ mode: 'first-time' })))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-disable-escape-key')).toBe('true')
  })

  it('review mode: disableEscapeKey attribute is false', () => {
    render(React.createElement(ThreePostureDisclosure, makeProps({ mode: 'review' })))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-disable-escape-key')).toBe('false')
  })
})

// =============================================================================
// AC #5: Focus management — acknowledge button is focused on open
// =============================================================================

describe('AC5 — focus management', () => {
  it('moves focus to the acknowledge button after mount (first-time mode)', async () => {
    render(React.createElement(ThreePostureDisclosure, makeProps({ mode: 'first-time' })))
    // requestAnimationFrame-based focus requires we flush the frame
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    const btn = screen.getByRole('button', { name: /got it, post/i })
    expect(document.activeElement).toBe(btn)
  })
})

// =============================================================================
// AC #6: prefers-reduced-motion — transition prop is '100ms' when reduced
// =============================================================================

describe('AC6 — prefers-reduced-motion', () => {
  it('Dialog.Content has transition="100ms" when useReducedMotion returns true', () => {
    useReducedMotionMock.mockReturnValue(true)
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    const content = screen.getByTestId('dialog-content')
    expect(content.getAttribute('data-transition')).toBe('100ms')
  })

  it('Dialog.Content transition is NOT "100ms" when useReducedMotion returns false', () => {
    useReducedMotionMock.mockReturnValue(false)
    render(React.createElement(ThreePostureDisclosure, makeProps()))
    const content = screen.getByTestId('dialog-content')
    expect(content.getAttribute('data-transition')).not.toBe('100ms')
  })
})

// =============================================================================
// AC #1 / #2: Exports — types exported from the module
// =============================================================================

describe('AC1/AC2 — module exports', () => {
  it('exports ThreePostureDisclosure component', async () => {
    const mod = await import('../ThreePostureDisclosure')
    expect(typeof mod.ThreePostureDisclosure).toBe('function')
  })

  it('ThreePostureDisclosure is a valid React component (renders without crashing)', () => {
    const props = makeProps()
    expect(() => render(React.createElement(ThreePostureDisclosure, props))).not.toThrow()
  })
})
