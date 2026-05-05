// @vitest-environment happy-dom
// WordCounter component — count rendering, color logic, a11y, no animation

import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── Mock tamagui — forward a11y + content + color props to a <span> ────────
// WordCounter imports { Text } from 'tamagui'; we intercept here.
// Mirror StreakChip.test.tsx mock exactly, extended to forward:
//   - color as data-color (needed for C2/C3 assertions)
//   - aria-live, aria-atomic as forwarded attributes (needed for C6)
// vi.mock is hoisted — defined before component import below.
import { vi } from 'vitest'

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
    'aria-live': ariaLive,
    'aria-atomic': ariaAtomic,
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
        // Forward color as data-color so C2/C3 can assert theme tokens
        ...(color !== undefined ? { 'data-color': String(color) } : {}),
        // Forward aria-live and aria-atomic for C6
        ...(ariaLive !== undefined ? { 'aria-live': ariaLive } : {}),
        ...(ariaAtomic !== undefined ? { 'aria-atomic': ariaAtomic } : {}),
        ...rest,
      },
      children
    )

  return { Text }
})

import { WordCounter } from '../WordCounter'

afterEach(cleanup)

// ─────────────────────────────────────────────────────────────────────────────
// C1 — Renders count + correct unit ("word" vs "words") (AC11 C1)
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter renders count with correct singular/plural unit (C1)', () => {
  it('renders "0 words" when count={0}', () => {
    render(React.createElement(WordCounter, { count: 0 }))
    expect(screen.getByText('0 words')).toBeTruthy()
  })

  it('renders "1 word" when count={1} — singular form', () => {
    render(React.createElement(WordCounter, { count: 1 }))
    expect(screen.getByText('1 word')).toBeTruthy()
  })

  it('renders "2 words" when count={2}', () => {
    render(React.createElement(WordCounter, { count: 2 }))
    expect(screen.getByText('2 words')).toBeTruthy()
  })

  it('renders "500 words" when count={500}', () => {
    render(React.createElement(WordCounter, { count: 500 }))
    expect(screen.getByText('500 words')).toBeTruthy()
  })

  it('does NOT render "1 words" (avoids wrong plural for singular)', () => {
    render(React.createElement(WordCounter, { count: 1 }))
    expect(screen.queryByText('1 words')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C2 — Color is $color8 (stone) when count < 450 (AC11 C2)
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter uses stone color ($color8) when count is below 450 (C2)', () => {
  it('has data-color="$color8" when count={0}', () => {
    render(React.createElement(WordCounter, { count: 0 }))
    const el = screen.getByText('0 words')
    expect(el.getAttribute('data-color')).toBe('$color8')
  })

  it('has data-color="$color8" when count={100}', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-color')).toBe('$color8')
  })

  it('has data-color="$color8" when count={449} — boundary: one below threshold', () => {
    render(React.createElement(WordCounter, { count: 449 }))
    const el = screen.getByText('449 words')
    expect(el.getAttribute('data-color')).toBe('$color8')
  })

  it('does NOT have data-color="$color" when count is below 450', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-color')).not.toBe('$color')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Color is $color (text) when count >= 450 (AC11 C3)
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter uses text color ($color) when count is at or above 450 (C3)', () => {
  it('has data-color="$color" when count={450} — exact threshold', () => {
    render(React.createElement(WordCounter, { count: 450 }))
    const el = screen.getByText('450 words')
    expect(el.getAttribute('data-color')).toBe('$color')
  })

  it('has data-color="$color" when count={500}', () => {
    render(React.createElement(WordCounter, { count: 500 }))
    const el = screen.getByText('500 words')
    expect(el.getAttribute('data-color')).toBe('$color')
  })

  it('has data-color="$color" when count={1000}', () => {
    render(React.createElement(WordCounter, { count: 1000 }))
    const el = screen.getByText('1000 words')
    expect(el.getAttribute('data-color')).toBe('$color')
  })

  it('does NOT have data-color="$color8" when count is at or above 450', () => {
    render(React.createElement(WordCounter, { count: 450 }))
    const el = screen.getByText('450 words')
    expect(el.getAttribute('data-color')).not.toBe('$color8')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C4 — Color reverts to stone when count drops back below 450 (AC11 C4)
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter color reverts to stone when count drops below 450 — pure function (C4)', () => {
  it('switches from $color to $color8 when count drops from 500 to 449', () => {
    const { rerender } = render(React.createElement(WordCounter, { count: 500 }))
    // First assert: at 500, color is text
    expect(screen.getByText('500 words').getAttribute('data-color')).toBe('$color')

    // Rerender with count below threshold
    rerender(React.createElement(WordCounter, { count: 449 }))
    // Color must revert — no latching behavior
    expect(screen.getByText('449 words').getAttribute('data-color')).toBe('$color8')
  })

  it('cycles correctly across the threshold boundary (450 → 449 → 450)', () => {
    const { rerender } = render(React.createElement(WordCounter, { count: 450 }))
    expect(screen.getByText('450 words').getAttribute('data-color')).toBe('$color')

    rerender(React.createElement(WordCounter, { count: 449 }))
    expect(screen.getByText('449 words').getAttribute('data-color')).toBe('$color8')

    rerender(React.createElement(WordCounter, { count: 450 }))
    expect(screen.getByText('450 words').getAttribute('data-color')).toBe('$color')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C5 — No animation/transition/enterStyle/exitStyle props (AC11 C5)
// Mirrors StreakChip.test.tsx:30-34 pattern exactly.
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter has no animation props — static Text by design (C5)', () => {
  it('rendered element has no data-animation attribute', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-animation')).toBeNull()
  })

  it('rendered element has no data-transition attribute', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-transition')).toBeNull()
  })

  it('rendered element has no data-enter-style attribute', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-enter-style')).toBeNull()
  })

  it('rendered element has no data-exit-style attribute', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('data-exit-style')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Accessibility props (AC11 C6)
// ─────────────────────────────────────────────────────────────────────────────
describe('WordCounter accessibility attributes (C6)', () => {
  it('has aria-live="polite" on the rendered element', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('aria-live')).toBe('polite')
  })

  it('has aria-atomic="true" on the rendered element', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('aria-atomic')).toBe('true')
  })

  it('has role="status" on the rendered element', () => {
    render(React.createElement(WordCounter, { count: 100 }))
    const el = screen.getByText('100 words')
    expect(el.getAttribute('role')).toBe('status')
  })

  it('is findable by getByRole("status")', () => {
    render(React.createElement(WordCounter, { count: 50 }))
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
