// @vitest-environment happy-dom
// Story 1-7: StreakChip component — placeholder text, dayCount prop, a11y, no animation (AC1, AC5, AC6)

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── Mock tamagui — forward a11y + content props to a <span> ────────────────
// StreakChip imports { Text } from 'tamagui'; we intercept here.
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
        ...rest,
      },
      children
    )

  return { Text }
})

import { StreakChip } from '../StreakChip'

afterEach(cleanup)

// ─────────────────────────────────────────────────────────────────────────────
// 1. Placeholder text rendering (AC1)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip renders placeholder text when no dayCount is given (AC1)', () => {
  it('renders "Day —" with no props', () => {
    render(React.createElement(StreakChip))
    expect(screen.getByText('Day —')).toBeTruthy()
  })

  it('renders "Day —" when dayCount is explicitly undefined', () => {
    render(React.createElement(StreakChip, { dayCount: undefined }))
    expect(screen.getByText('Day —')).toBeTruthy()
  })

  it('does NOT render "Day 0" when dayCount is 0 — falls back to placeholder (AC1 edge case)', () => {
    // dayCount=0 is a streak-zero edge case; per story spec the ?? operator means 0 renders as
    // "Day 0" (nullish coalescing), but the story notes this as a 2-7 contract gap to revisit.
    // This test documents the DESIRED behavior: dayCount=0 should render placeholder "Day —",
    // NOT "Day 0". This test is intentionally red until the implementation handles 0 specially.
    render(React.createElement(StreakChip, { dayCount: 0 }))
    // Should not contain "Day 0"
    expect(screen.queryByText('Day 0')).toBeNull()
    // Should show the placeholder instead
    expect(screen.getByText('Day —')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. dayCount prop rendering (AC1)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip renders dayCount when provided (AC1)', () => {
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
// 3. Accessibility (AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip accessibility (AC6)', () => {
  it('has accessibilityLabel "Day — streak" with no props', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('aria-label')).toBe('Day — streak')
  })

  it('has accessibilityLabel "Day 5 streak" when dayCount={5}', () => {
    render(React.createElement(StreakChip, { dayCount: 5 }))
    const chip = screen.getByText('Day 5')
    expect(chip.getAttribute('aria-label')).toBe('Day 5 streak')
  })

  it('has accessibilityRole="text" (non-interactive chip) (AC6)', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('role')).toBe('text')
  })

  it('is reachable by getByRole("text", { name: "Day — streak" })', () => {
    render(React.createElement(StreakChip))
    // Verify the element exposes the correct accessible name
    expect(screen.getByRole('text', { name: 'Day — streak' })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. No animation / transition props (AC5)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip has no animation props — static by design (AC5)', () => {
  it('rendered element has no data-animation attribute', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-animation')).toBeNull()
  })

  it('rendered element has no data-transition attribute', () => {
    render(React.createElement(StreakChip))
    const chip = screen.getByText('Day —')
    expect(chip.getAttribute('data-transition')).toBeNull()
  })

  it('rendered element has no data-enter-style attribute', () => {
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
