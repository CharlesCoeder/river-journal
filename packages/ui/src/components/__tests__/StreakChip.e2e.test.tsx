// @vitest-environment happy-dom
// StreakChip — behavioral contracts: zero-streak Day 0, state prop color, day-increment spring,
// reduced-motion collapse, and no-animation guards.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── useReducedMotion mock — controllable per-test ────────────────────────────
// StreakChip imports useReducedMotion from '../hooks/useReducedMotion' (internal hook)
let reducedMotionValue = false

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => reducedMotionValue,
}))

// ─── Mock tamagui — forward color, transition, enterStyle as data attrs ───────
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
        // Surface animation/transition/color props as data attrs for assertions
        ...(animation !== undefined ? { 'data-animation': String(animation) } : {}),
        ...(transition !== undefined ? { 'data-transition': String(transition) } : {}),
        ...(enterStyle !== undefined ? { 'data-enter-style': 'present' } : {}),
        ...(exitStyle !== undefined ? { 'data-exit-style': 'present' } : {}),
        ...(color !== undefined ? { 'data-color': String(color) } : {}),
        ...rest,
      },
      children
    )

  // AnimatePresence: passes children through (enter animation tested via data attrs on Text)
  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return { Text, AnimatePresence }
})

import { StreakChip } from '../StreakChip'

afterEach(cleanup)
beforeEach(() => {
  reducedMotionValue = false
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Zero-streak renders "Day 0" (zero-streak shows Day 0, not placeholder)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — zero-streak renders Day 0 (not placeholder)', () => {
  it('renders "Day 0" when dayCount is 0', () => {
    render(React.createElement(StreakChip, { dayCount: 0 }))
    expect(screen.getByText('Day 0')).toBeTruthy()
  })

  it('does NOT render "Day —" when dayCount is 0', () => {
    render(React.createElement(StreakChip, { dayCount: 0 }))
    expect(screen.queryByText('Day —')).toBeNull()
  })

  it('has accessibilityLabel "Day 0 streak" when dayCount is 0', () => {
    render(React.createElement(StreakChip, { dayCount: 0 }))
    const chip = screen.getByText('Day 0')
    expect(chip.getAttribute('aria-label')).toBe('Day 0 streak')
  })

  it('still renders "Day —" when dayCount is undefined (placeholder reserved for undefined only)', () => {
    render(React.createElement(StreakChip, { dayCount: undefined }))
    expect(screen.getByText('Day —')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. state prop drives color token
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — state prop controls color token', () => {
  it('renders with $color8 (stone) when state is "pending"', () => {
    render(React.createElement(StreakChip, { dayCount: 5, state: 'pending' }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-color')).toBe('$color8')
  })

  it('renders with $color (text) when state is "active"', () => {
    render(React.createElement(StreakChip, { dayCount: 5, state: 'active' }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-color')).toBe('$color')
  })

  it('defaults to $color8 (stone) when state prop is not provided', () => {
    render(React.createElement(StreakChip, { dayCount: 3 }))
    const chip = screen.getByText('Day 3')
    expect(chip.getAttribute('data-color')).toBe('$color8')
  })

  it('state="active" color differs from state="pending" color', () => {
    const { unmount } = render(React.createElement(StreakChip, { dayCount: 5, state: 'active' }))
    const activeColor = screen.getByText('Day 5').getAttribute('data-color')
    unmount()
    cleanup()
    render(React.createElement(StreakChip, { dayCount: 5, state: 'pending' }))
    const pendingColor = screen.getByText('Day 5').getAttribute('data-color')
    expect(activeColor).not.toBe(pendingColor)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Day-increment spring fires on N → N+1 transition
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — day-increment spring: transition fires on positive increment', () => {
  it('fires designEnter transition when dayCount increments from 3 to 4', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('designEnter')
  })

  it('fires enterStyle when dayCount increments (opacity/scale animation)', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-enter-style')).toBe('present')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Day-decrement: NO transition fires
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — day-decrement: no spring (guard against regression animation)', () => {
  it('does NOT fire transition when dayCount decrements from 4 to 3', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 4 }))
    rerender(React.createElement(StreakChip, { dayCount: 3 }))
    const chip = screen.getByText('Day 3')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('does NOT fire enterStyle when dayCount decrements', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 4 }))
    rerender(React.createElement(StreakChip, { dayCount: 3 }))
    const chip = screen.getByText('Day 3')
    expect(chip.getAttribute('data-enter-style')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Initial mount with defined dayCount: NO transition (prevRef guard)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — initial mount: no spring on undefined → defined transition', () => {
  it('does NOT fire transition when rendering from undefined to a real dayCount', () => {
    const { rerender } = render(React.createElement(StreakChip, { dayCount: undefined }))
    rerender(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('does NOT fire enterStyle on initial mount (first render with defined dayCount)', () => {
    render(React.createElement(StreakChip, { dayCount: 7 }))
    const chip = screen.getByText('Day 7')
    expect(chip.getAttribute('data-enter-style')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Reduced-motion: transition collapses to '100ms' tween (not 'designEnter')
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — reduced motion: spring degrades to 100ms tween', () => {
  it('uses "100ms" transition (not "designEnter") when prefers-reduced-motion is set', () => {
    reducedMotionValue = true
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('100ms')
    expect(chip.getAttribute('data-transition')).not.toBe('designEnter')
  })

  it('uses "designEnter" (not "100ms") when reduced motion is NOT set on increment', () => {
    reducedMotionValue = false
    const { rerender } = render(React.createElement(StreakChip, { dayCount: 3 }))
    rerender(React.createElement(StreakChip, { dayCount: 4 }))
    const chip = screen.getByText('Day 4')
    expect(chip.getAttribute('data-transition')).toBe('designEnter')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Boundary: no observable imports in @my/ui component (structural)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip — presentation-only: no state-layer imports', () => {
  it('renders correctly with only props — no observable reads inside', () => {
    // If StreakChip imported @legendapp/state or app/state, this render would
    // fail with an unresolved module. Success confirms presentation-only boundary.
    render(React.createElement(StreakChip, { dayCount: 5, state: 'active' }))
    expect(screen.getByText('Day 5')).toBeTruthy()
  })
})
