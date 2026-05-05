// @vitest-environment happy-dom
// StreakChip component — placeholder text, dayCount prop, a11y, animation, state prop

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── Mock useReducedMotion — avoids react-native import ──────────────────────
const { useReducedMotionMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn(() => false),
}))
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: useReducedMotionMock,
}))

// ─── Mock tamagui — forward a11y + content props to a <span> ────────────────
// StreakChip imports { AnimatePresence, Text } from 'tamagui'; we intercept here.
vi.mock('tamagui', () => {
  const ReactModule = require('react')

  const Text = ({
    children,
    accessibilityRole,
    accessibilityLabel,
    testID,
    animation,
    transition,
    enterStyle,
    exitStyle,
    role,
    color,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityRole || role ? { role: accessibilityRole ?? role } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        // Surface animation/transition props as data attrs so tests can assert absence
        ...(animation !== undefined ? { 'data-animation': String(animation) } : {}),
        ...(transition !== undefined ? { 'data-transition': String(transition) } : {}),
        ...(enterStyle !== undefined ? { 'data-enter-style': 'present' } : {}),
        ...(exitStyle !== undefined ? { 'data-exit-style': 'present' } : {}),
        // Surface color prop for state-prop assertions
        ...(color !== undefined ? { 'data-color': String(color) } : {}),
        ...rest,
      },
      children
    )

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return { Text, AnimatePresence }
})

import { StreakChip } from '../StreakChip'

afterEach(() => {
  cleanup()
  useReducedMotionMock.mockReturnValue(false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Placeholder text rendering
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip renders placeholder text when no dayCount is given', () => {
  it('renders "Day —" with no props', () => {
    render(React.createElement(StreakChip))
    expect(screen.getByText('Day —')).toBeTruthy()
  })

  it('renders "Day —" when dayCount is explicitly undefined', () => {
    render(React.createElement(StreakChip, { dayCount: undefined }))
    expect(screen.getByText('Day —')).toBeTruthy()
  })

  it('renders "Day 0" when dayCount is 0 — does NOT collapse to placeholder', () => {
    // Per story spec: dayCount=0 renders "Day 0", NOT "Day —"
    // Zero-streak shows "Day 0" to keep chip placement predictable.
    render(React.createElement(StreakChip, { dayCount: 0 }))
    expect(screen.getByText('Day 0')).toBeTruthy()
    expect(screen.queryByText('Day —')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. dayCount prop rendering
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip renders dayCount when provided', () => {
  it('renders "Day 5" when dayCount={5}', () => {
    render(React.createElement(StreakChip, { dayCount: 5 }))
    expect(screen.getByText('Day 5')).toBeTruthy()
  })

  it('renders "Day 1" when dayCount={1}', () => {
    render(React.createElement(StreakChip, { dayCount: 1 }))
    expect(screen.getByText('Day 1')).toBeTruthy()
  })

  it('renders "Day 100" when dayCount={100}', () => {
    render(React.createElement(StreakChip, { dayCount: 100 }))
    expect(screen.getByText('Day 100')).toBeTruthy()
  })

  it('does NOT render placeholder "Day —" when dayCount is a positive number', () => {
    render(React.createElement(StreakChip, { dayCount: 7 }))
    expect(screen.queryByText('Day —')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Accessibility
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip accessibility', () => {
  it('has accessibilityLabel "Day — streak" with no props', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('aria-label')).toBe('Day — streak')
  })

  it('has accessibilityLabel "Day 0 streak" when dayCount={0}', () => {
    render(React.createElement(StreakChip, { dayCount: 0 }))
    const chip = screen.getByText('Day 0')
    expect(chip.getAttribute('aria-label')).toBe('Day 0 streak')
  })

  it('has accessibilityLabel "Day 5 streak" when dayCount={5}', () => {
    render(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('aria-label')).toBe('Day 5 streak')
  })

  it('has accessibilityRole="text" (non-interactive chip)', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('role')).toBe('text')
  })

  it('is reachable by getByRole("text", { name: "Day — streak" })', () => {
    render(React.createElement(StreakChip))
    expect(screen.getByRole('text', { name: 'Day — streak' })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. state prop controls color token
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip state prop controls color', () => {
  it('state="pending" (default) uses $color8 (stone)', () => {
    render(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-color')).toBe('$color8')
  })

  it('state="pending" explicit uses $color8', () => {
    render(React.createElement(StreakChip, { dayCount: 5, state: 'pending' }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-color')).toBe('$color8')
  })

  it('state="active" uses $color (text token — higher contrast)', () => {
    render(React.createElement(StreakChip, { dayCount: 5, state: 'active' }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-color')).toBe('$color')
  })

  it('state="active" renders different color than state="pending"', () => {
    const { unmount } = render(React.createElement(StreakChip, { dayCount: 5, state: 'pending' }))
    const pendingColor = screen.getByText('Day 5').getAttribute('data-color')
    unmount()
    render(React.createElement(StreakChip, { dayCount: 5, state: 'active' }))
    const activeColor = screen.getByText('Day 5').getAttribute('data-color')
    expect(activeColor).not.toBe(pendingColor)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Day-increment spring: fires on N → N+1 only
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip day-increment spring', () => {
  it('fires designEnter transition on increment (3 → 4)', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('designEnter')
    expect(chip.getAttribute('data-enter-style')).toBe('present')
  })

  it('does NOT fire transition on decrement (4 → 3)', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 4 }))
    rerender(React.createElement(StreakChip, { dayCount: 3 }))
    const chip = screen.getByText('Day 3')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('does NOT fire transition on initial mount with defined dayCount', () => {
    render(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('does NOT fire transition when dayCount goes from undefined to defined (initial mount of real value)', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: undefined }))
    rerender(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. prefers-reduced-motion collapses spring to 100ms
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip prefers-reduced-motion', () => {
  it('collapses designEnter to "100ms" tween under reduced motion', () => {
    useReducedMotionMock.mockReturnValue(true)
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('100ms')
  })

  it('uses designEnter when reduced motion is off', () => {
    useReducedMotionMock.mockReturnValue(false)
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('designEnter')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. No animation on static renders
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip has no animation props on static render — static by design', () => {
  it('rendered element has no data-animation attribute', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-animation')).toBeNull()
  })

  it('rendered element has no data-transition attribute on initial render', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('rendered element has no data-enter-style attribute on initial render', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-enter-style')).toBeNull()
  })

  it('rendered element has no data-exit-style attribute', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-exit-style')).toBeNull()
  })
})
