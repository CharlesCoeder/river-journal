// @vitest-environment happy-dom
/**
 * Story 3-8 — TDD red-phase unit tests for `packages/ui/src/components/AuthorByline.tsx`.
 *
 * Red-phase contract: every test MUST fail until Story 3-8's Task 1 creates
 * `packages/ui/src/components/AuthorByline.tsx`.
 *
 * AC coverage (AC #1–#7, #26):
 *   t1 — renders displayName · postedAt with no tenure label (AC #2, #26-t1)
 *   t2 — renders tenure labels for all three tiers (AC #2, #3, #26-t2)
 *   t3 — deletedDisplay suppresses tenure even if tenureTier set (AC #4, #26-t3)
 *   t4 — tenure label renders in italic (AC #2, #26-t4)
 *   t5 — relative time formatting: 3h, 2d, short-date (AC #5, #26-t5)
 *   t6 — numberOfLines={1} on outer text container (AC #2, #26-t6)
 *   t7 — no avatar/image markup (AC #7, #26-t7)
 *   t8 — TENURE_TIER_LABEL is exported as a const (AC #3)
 *   t9 — a11y label flattens to single announcement (AC #6)
 *
 * Mock strategy: mock @my/ui (Tamagui) and forward a11y props to DOM elements;
 * mirrors StreakChip.test.tsx pattern.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── Mock useReducedMotion ────────────────────────────────────────────────────
const { useReducedMotionMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn(() => false),
}))

// ─── Mock tamagui / @my/ui primitives ─────────────────────────────────────────
// AuthorByline uses XStack + Text from tamagui or @my/ui.
// We forward key props to DOM equivalents for assertion.
vi.mock('tamagui', () => {
  const ReactModule = require('react')

  const Text = ({
    children,
    fontStyle,
    fontSize,
    color,
    fontFamily,
    numberOfLines,
    accessibilityRole,
    accessibilityLabel,
    role,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...(fontStyle ? { 'data-font-style': fontStyle } : {}),
        ...(color ? { 'data-color': color } : {}),
        ...(numberOfLines !== undefined ? { 'data-number-of-lines': String(numberOfLines) } : {}),
        ...(accessibilityRole || role ? { role: accessibilityRole ?? role } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      },
      children
    )

  const XStack = ({
    children,
    accessible,
    accessibilityRole,
    accessibilityLabel,
    role,
    'aria-label': ariaLabel,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-stack': 'x',
        ...(accessible ? { 'data-accessible': 'true' } : {}),
        // AuthorByline uses web a11y props (role / aria-label); accept both the
        // RN (accessibility*) and web spellings so the rendered DOM carries them.
        ...(accessibilityRole || role ? { role: accessibilityRole ?? role } : {}),
        ...(accessibilityLabel || ariaLabel
          ? { 'aria-label': accessibilityLabel ?? ariaLabel }
          : {}),
      },
      children
    )

  const View = ({ children, accessible, accessibilityRole, accessibilityLabel, ...rest }: any) =>
    ReactModule.createElement(
      'div',
      {
        ...(accessible ? { 'data-accessible': 'true' } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      },
      children
    )

  return { Text, XStack, View }
})

// Also mock @my/ui in case AuthorByline imports from there
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const Text = ({
    children,
    fontStyle,
    fontSize,
    color,
    fontFamily,
    numberOfLines,
    accessibilityRole,
    accessibilityLabel,
    role,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...(fontStyle ? { 'data-font-style': fontStyle } : {}),
        ...(color ? { 'data-color': color } : {}),
        ...(numberOfLines !== undefined ? { 'data-number-of-lines': String(numberOfLines) } : {}),
        ...(accessibilityRole || role ? { role: accessibilityRole ?? role } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      },
      children
    )

  const XStack = ({
    children,
    accessible,
    accessibilityRole,
    accessibilityLabel,
    role,
    'aria-label': ariaLabel,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-stack': 'x',
        ...(accessible ? { 'data-accessible': 'true' } : {}),
        // AuthorByline uses web a11y props (role / aria-label); accept both the
        // RN (accessibility*) and web spellings so the rendered DOM carries them.
        ...(accessibilityRole || role ? { role: accessibilityRole ?? role } : {}),
        ...(accessibilityLabel || ariaLabel
          ? { 'aria-label': accessibilityLabel ?? ariaLabel }
          : {}),
      },
      children
    )

  const View = ({ children, accessible, accessibilityRole, accessibilityLabel, ...rest }: any) =>
    ReactModule.createElement(
      'div',
      {
        ...(accessible ? { 'data-accessible': 'true' } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      },
      children
    )

  return {
    Text,
    XStack,
    View,
    useReducedMotion: useReducedMotionMock,
  }
})

// ─── Import under test — will fail until AuthorByline.tsx exists ──────────────
import { AuthorByline, TENURE_TIER_LABEL } from '../AuthorByline'

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — renders displayName · postedAt with no tenure label when tenureTier is undefined
// AC #2, #26-t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t1 — base rendering (AC #2)', () => {
  it('renders displayName text', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
    render(React.createElement(AuthorByline, { displayName: 'Alice', postedAt }))
    expect(screen.getByText(/Alice/)).not.toBeNull()
  })

  it('does NOT render any tenure label when tenureTier is undefined', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Alice', postedAt }))
    expect(screen.queryByText(/Day 30\+/)).toBeNull()
    expect(screen.queryByText(/Day 100\+/)).toBeNull()
    expect(screen.queryByText(/Year\+/)).toBeNull()
  })

  it('renders the separator dot between name and time', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Alice', postedAt }))
    // Should contain a dot separator
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/Alice\s*·/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — renders tenure labels for all three tiers
// AC #2, #3, #26-t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t2 — tenure tier labels (AC #2, #3)', () => {
  it('renders "Day 30+" when tenureTier===30', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Bob', postedAt, tenureTier: 30 }))
    expect(screen.getByText(/Day 30\+/)).not.toBeNull()
  })

  it('renders "Day 100+" when tenureTier===100', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Carol', postedAt, tenureTier: 100 }))
    expect(screen.getByText(/Day 100\+/)).not.toBeNull()
  })

  it('renders "Year+" when tenureTier===365', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Dave', postedAt, tenureTier: 365 }))
    expect(screen.getByText(/Year\+/)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — deletedDisplay suppresses tenure even if tenureTier is set
// AC #4, #26-t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t3 — deletedDisplay suppresses tenure (AC #4)', () => {
  it('renders "[deleted]" in name slot when deletedDisplay===true', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, {
      displayName: 'Alice',
      postedAt,
      deletedDisplay: true,
    }))
    expect(screen.getByText(/\[deleted\]/)).not.toBeNull()
    expect(screen.queryByText('Alice')).toBeNull()
  })

  it('does NOT render tenure label when deletedDisplay===true even if tenureTier===30', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, {
      displayName: 'Alice',
      postedAt,
      deletedDisplay: true,
      tenureTier: 30,
    }))
    expect(screen.queryByText(/Day 30\+/)).toBeNull()
  })

  it('does NOT render tenure label when deletedDisplay===true even if tenureTier===365', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, {
      displayName: 'Bob',
      postedAt,
      deletedDisplay: true,
      tenureTier: 365,
    }))
    expect(screen.queryByText(/Year\+/)).toBeNull()
  })

  it('retains the timestamp even when deletedDisplay===true', () => {
    const postedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3h ago
    render(React.createElement(AuthorByline, {
      displayName: 'Alice',
      postedAt,
      deletedDisplay: true,
    }))
    // Timestamp should still be visible in some form (h or "h ago" or date)
    const text = document.body.textContent ?? ''
    // Should contain time info — either "h", "d", or a date
    expect(text).toMatch(/[0-9]+[hd]|[A-Z][a-z]{2}\s+[0-9]+/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — tenure label renders in italic
// AC #2, #26-t4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t4 — tenure label italic style (AC #2)', () => {
  it('tenure label element has fontStyle="italic" (data-font-style="italic")', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Eve', postedAt, tenureTier: 100 }))

    // The element rendering the tenure label should have italic font style
    const italicEl = document.querySelector('[data-font-style="italic"]')
    expect(italicEl).not.toBeNull()
    expect(italicEl?.textContent).toMatch(/Day 100\+/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — relative time formatting
// AC #5, #26-t5
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t5 — relative time formatting (AC #5)', () => {
  it('formats timestamp ~3 hours ago as "3h" or matching relative pattern', () => {
    const postedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Frank', postedAt }))
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/3\s*h(?:ours?\s*ago)?/)
  })

  it('formats timestamp ~2 days ago as "2d" or matching relative pattern', () => {
    const postedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Grace', postedAt }))
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/2\s*d(?:ays?\s*ago)?/)
  })

  it('formats timestamp >= 7 days ago as short-date (e.g. "Apr 29" or "May 6")', () => {
    // 10 days ago
    const postedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Hal', postedAt }))
    const text = document.body.textContent ?? ''
    // Should match a month name (abbreviated or full) followed by a number
    expect(text).toMatch(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — numberOfLines={1} on the outer text container
// AC #2, #26-t6
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t6 — single-line truncation (AC #2)', () => {
  it('outer text element has numberOfLines=1 (data-number-of-lines="1")', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Ivy', postedAt }))

    const singleLine = document.querySelector('[data-number-of-lines="1"]')
    expect(singleLine).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — no avatar/image markup
// AC #7, #26-t7
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t7 — no avatar or image (AC #7)', () => {
  it('renders no <img> element', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Jack', postedAt }))
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('renders no element with role="img"', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Jack', postedAt }))
    expect(screen.queryAllByRole('img').length).toBe(0)
  })

  it('renders no Avatar or sigil component', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Jack', postedAt }))
    // No Avatar text in DOM
    const text = document.body.innerHTML
    expect(text).not.toMatch(/Avatar/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — TENURE_TIER_LABEL is exported and correct
// AC #3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t8 — TENURE_TIER_LABEL export (AC #3)', () => {
  it('exports TENURE_TIER_LABEL as a const with correct values', () => {
    expect(TENURE_TIER_LABEL).toBeDefined()
    expect(TENURE_TIER_LABEL[30]).toBe('Day 30+')
    expect(TENURE_TIER_LABEL[100]).toBe('Day 100+')
    expect(TENURE_TIER_LABEL[365]).toBe('Year+')
  })

  it('TENURE_TIER_LABEL has exactly 3 entries', () => {
    expect(Object.keys(TENURE_TIER_LABEL).length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — a11y label flattens to single announcement
// AC #6
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-8 / AuthorByline t9 — a11y label (AC #6)', () => {
  it('has an accessible label that includes the displayName', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Karen', postedAt }))
    const labeled = document.querySelector('[aria-label]')
    expect(labeled).not.toBeNull()
    expect(labeled?.getAttribute('aria-label')).toMatch(/Karen/)
  })

  it('a11y label includes "posted" and time info', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Leo', postedAt }))
    const labeled = document.querySelector('[aria-label]')
    expect(labeled?.getAttribute('aria-label')).toMatch(/posted/i)
  })

  it('a11y label includes tenure label when tenureTier is set', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Mia', postedAt, tenureTier: 30 }))
    const labeled = document.querySelector('[aria-label]')
    expect(labeled?.getAttribute('aria-label')).toMatch(/Day 30\+/)
  })

  it('outer wrapper does NOT have role="button" — it is purely descriptive text', () => {
    const postedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(React.createElement(AuthorByline, { displayName: 'Nina', postedAt }))
    expect(screen.queryAllByRole('button').length).toBe(0)
  })
})
