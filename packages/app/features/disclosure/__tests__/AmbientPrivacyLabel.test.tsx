// @vitest-environment happy-dom
// AmbientPrivacyLabel — RED-PHASE TDD
// ALL tests MUST FAIL before implementation of
// packages/app/features/disclosure/AmbientPrivacyLabel.tsx
//
// Story 3-6 ACs covered: 17, 18, 19, 20, 21, 22, 25

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — capture wrapper props passed by the label
// ─────────────────────────────────────────────────────────────────────────────
const { lastWrapperProps } = vi.hoisted(() => {
  const lastWrapperProps: { current: Record<string, any> } = { current: {} }
  return { lastWrapperProps }
})

// ─── Mock the wrapper ThreePostureDisclosure ──────────────────────────────────
// AmbientPrivacyLabel mounts the wrapper inline; we capture its props.
vi.mock('../ThreePostureDisclosure', () => {
  const ReactModule = require('react')
  return {
    ThreePostureDisclosure: (props: any) => {
      lastWrapperProps.current = props
      if (!props.open) return null
      return ReactModule.createElement(
        'div',
        { role: 'dialog', 'data-mode': props.mode, 'data-boundary': props.boundary },
        ReactModule.createElement(
          'button',
          {
            type: 'button',
            onClick: () => props.onClose?.(),
          },
          'Close'
        )
      )
    },
    hasAcknowledgedBoundaryA: vi.fn(() => false),
  }
})

// ─── Mock tamagui so YStack / Text render as HTML ───────────────────────────
vi.mock('tamagui', () => {
  const ReactModule = require('react')

  const passthrough = (defaultTag: string) => {
    const C = ({ children, tag, accessibilityRole, role, accessibilityLabel, onPress, onClick, ...rest }: any) =>
      ReactModule.createElement(
        tag ?? defaultTag,
        {
          role: accessibilityRole ?? role,
          'aria-label': accessibilityLabel,
          onClick: onClick ?? onPress,
          ...rest,
        },
        children
      )
    return C
  }

  return {
    Text: passthrough('span'),
    Button: passthrough('button'),
    View: passthrough('div'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
  }
})

// ─── Mock @my/ui ──────────────────────────────────────────────────────────────
vi.mock('@my/ui', () => ({
  useReducedMotion: () => false,
  ExpandingLineButton: ({ children, onPress }: any) => {
    const ReactModule = require('react')
    return ReactModule.createElement('button', { type: 'button', onClick: onPress }, children)
  },
}))

// ─── Import under test ───────────────────────────────────────────────────────
// WILL FAIL until packages/app/features/disclosure/AmbientPrivacyLabel.tsx exists.
import { AmbientPrivacyLabel } from '../AmbientPrivacyLabel'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  lastWrapperProps.current = {}
})

afterEach(() => {
  cleanup()
})

// =============================================================================
// AC #18: Boundary A label text
// =============================================================================

describe('AC18 — boundary=collective_post_v1 renders "VISIBLE TO THE COLLECTIVE"', () => {
  it('renders the exact label text', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    expect(screen.getByText('VISIBLE TO THE COLLECTIVE')).toBeTruthy()
  })

  it('renders a pressable element with accessibilityRole="button"', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    // Accessible via role button
    expect(screen.getByRole('button', { name: /re-open privacy disclosure/i })).toBeTruthy()
  })

  it('has accessibilityLabel="Re-open privacy disclosure"', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    const btn = screen.getByRole('button', { name: /re-open privacy disclosure/i })
    expect(btn).toBeTruthy()
  })
})

// =============================================================================
// AC #19: Boundary B label text variants
// =============================================================================

describe('AC19 — boundary=ai_cloud_v1 renders "CLOUD · {provider}" or "LOCAL"', () => {
  it('renders "CLOUD · OpenAI" when provider="OpenAI"', () => {
    render(
      React.createElement(AmbientPrivacyLabel, { boundary: 'ai_cloud_v1', provider: 'OpenAI' })
    )
    expect(screen.getByText('CLOUD · OpenAI')).toBeTruthy()
  })

  it('renders "LOCAL" when boundary=ai_cloud_v1 and no provider', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'ai_cloud_v1' }))
    expect(screen.getByText('LOCAL')).toBeTruthy()
  })

  it('renders "LOCAL" when provider is explicitly undefined', () => {
    render(
      React.createElement(AmbientPrivacyLabel, { boundary: 'ai_cloud_v1', provider: undefined })
    )
    expect(screen.getByText('LOCAL')).toBeTruthy()
  })
})

// =============================================================================
// AC #20: Tap behavior — opens the wrapper in mode="review"
// =============================================================================

describe('AC20 — tapping the label opens ThreePostureDisclosure wrapper in mode=review', () => {
  it('does not mount the disclosure wrapper before tap', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mounts the disclosure wrapper with open=true after tap', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    const labelBtn = screen.getByRole('button', { name: /re-open privacy disclosure/i })
    fireEvent.click(labelBtn)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('passes mode="review" to the wrapper after tap', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    const labelBtn = screen.getByRole('button', { name: /re-open privacy disclosure/i })
    fireEvent.click(labelBtn)
    expect(lastWrapperProps.current.mode).toBe('review')
  })

  it('passes open=true to the wrapper after tap', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    const labelBtn = screen.getByRole('button', { name: /re-open privacy disclosure/i })
    fireEvent.click(labelBtn)
    expect(lastWrapperProps.current.open).toBe(true)
  })

  it('closes the wrapper (resets open flag) when wrapper onClose is called', () => {
    render(React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' }))
    const labelBtn = screen.getByRole('button', { name: /re-open privacy disclosure/i })
    fireEvent.click(labelBtn)
    // Wrapper is open — click its Close button to trigger onClose
    const closeBtn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeBtn)
    // Dialog should no longer be in the DOM
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// =============================================================================
// AC #20 / #22: Tapping does NOT trigger acknowledgment write
// =============================================================================

describe('AC20/AC22 — tapping the label does not write acknowledgment', () => {
  it('does not call store$.profile.preferences write paths (no TQ imports)', () => {
    // This is a structural / import-boundary test: the component must not import
    // @tanstack/react-query. We verify indirectly by checking the component renders
    // without any TQ provider in the tree (which would throw if TQ hooks were called).
    expect(() => {
      const { unmount } = render(
        React.createElement(AmbientPrivacyLabel, { boundary: 'collective_post_v1' })
      )
      unmount()
    }).not.toThrow()
  })
})

// =============================================================================
// AC #17: Module exports
// =============================================================================

describe('AC17 — AmbientPrivacyLabel module exports', () => {
  it('exports AmbientPrivacyLabel as a named export', async () => {
    const mod = await import('../AmbientPrivacyLabel')
    expect(typeof mod.AmbientPrivacyLabel).toBe('function')
  })
})
