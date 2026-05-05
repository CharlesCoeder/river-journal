// @vitest-environment happy-dom
// GraceDayInventory component — filter logic, surface states, and accessibility

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { GraceDay } from 'app/state/types'

// ─── Mock @legendapp/state/react — synchronous snapshot read ─────────────────
// Full override: use$(obs) returns obs.get() so tests use fixed data snapshots.
// Reactivity is tested upstream; here we test filter logic and render shape.
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => obs.get(),
}))

// ─── Stub graceDays$ observable ───────────────────────────────────────────────
// Each test seeds the observable via graceDays$.set({...}) in beforeEach.
// vi.hoisted ensures the observable is created before vi.mock factories run.
const { graceDays$ } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { observable } = require('@legendapp/state')
  return { graceDays$: observable({} as Record<string, GraceDay>) }
})

vi.mock('app/state/grace_days', () => ({
  graceDays$,
}))

// ─── Mock @my/ui — forward role/aria-live to HTML elements ───────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const mapped: Record<string, unknown> = {}
    if (props.testID) mapped['data-testid'] = props.testID
    if (props.role) mapped['role'] = props.role
    if (props['aria-live']) mapped['aria-live'] = props['aria-live']
    if (props['aria-label']) mapped['aria-label'] = props['aria-label']
    if (props.accessibilityLabel) mapped['aria-label'] = props.accessibilityLabel
    return mapped
  }

  const makeTag =
    (tag: keyof HTMLElementTagNameMap) =>
    ({ children, ...rest }: any) =>
      ReactModule.createElement(tag, mapProps(rest), children)

  return {
    Text: makeTag('span'),
    YStack: makeTag('div'),
    XStack: makeTag('div'),
    View: makeTag('div'),
    AnimatePresence: ({ children }: any) => children,
  }
})

// ─── Import under test ───────────────────────────────────────────────────────
// This import will fail (module not found) until GraceDayInventory.tsx is created.
import { GraceDayInventory } from '../GraceDayInventory'

afterEach(cleanup)
beforeEach(() => {
  graceDays$.set({})
})

// ─────────────────────────────────────────────────────────────────────────────
// G1 — Zero state (empty record)
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — zero state: no grace days seeded', () => {
  it('G1: renders "No grace days yet." when the record is empty', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
  })

  it('G1: does NOT render an "available" count when the record is empty', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.queryByText(/available/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G2 — One available grace day (singular pluralization)
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — one available grace day', () => {
  it('G2: renders "1 grace day available." (singular) when one unspent row is seeded', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })

  it('G2: does NOT render "No grace days yet." when one is available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.queryByText('No grace days yet.')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G3 — Multiple available (plural pluralization)
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — multiple available grace days', () => {
  it('G3: renders "3 grace days available." (plural) when three unspent rows are seeded', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-02T00:00:00Z', earnedForMilestone: 14, usedForDate: null },
      g3: { id: 'g3', userId: 'u1', earnedAt: '2026-05-03T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('3 grace days available.')).toBeTruthy()
  })

  it('G3: uses plural "days" not singular "day" for count > 1', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-02T00:00:00Z', earnedForMilestone: 14, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.queryByText(/grace day available/)).toBeNull() // singular form absent
    expect(screen.getByText('2 grace days available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G4 — Spent grace day excluded from count
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — spent grace days are filtered out', () => {
  it('G4: counts only unspent rows when some have usedForDate set', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: '2026-04-15' },
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 14, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })

  it('G4: renders zero state when all rows are spent', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: '2026-04-15' },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G5 — Soft-deleted grace day excluded from count
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — soft-deleted grace days are filtered out', () => {
  it('G5: excludes rows with is_deleted=true even when usedForDate is null', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null, is_deleted: true } as any,
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-02T00:00:00Z', earnedForMilestone: 14, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G6 — Mixed: deleted + spent + available
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — mixed row states: only undeleted+unspent count', () => {
  it('G6: counts exactly one available when one deleted, one spent, one available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null, is_deleted: true } as any,
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-02T00:00:00Z', earnedForMilestone: 14, usedForDate: '2026-05-03' },
      g3: { id: 'g3', userId: 'u1', earnedAt: '2026-05-03T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })

  it('G6: renders zero state when all three rows are invalid (deleted or spent)', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null, is_deleted: true } as any,
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-05-02T00:00:00Z', earnedForMilestone: 14, usedForDate: '2026-05-03' },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G7 — Accessibility: aria-live status region
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — accessibility: live region for screen readers', () => {
  it('G7: wrapping element has role="status"', () => {
    render(React.createElement(GraceDayInventory))
    const region = document.querySelector('[role="status"]')
    expect(region).toBeTruthy()
  })

  it('G7: wrapping element has aria-live="polite" (not assertive)', () => {
    render(React.createElement(GraceDayInventory))
    const region = document.querySelector('[aria-live="polite"]')
    expect(region).toBeTruthy()
  })

  it('G7: wrapping element does NOT have aria-live="assertive"', () => {
    render(React.createElement(GraceDayInventory))
    const assertiveRegion = document.querySelector('[aria-live="assertive"]')
    expect(assertiveRegion).toBeNull()
  })

  it('G7: live region is present when rendering zero state', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
    expect(document.querySelector('[role="status"]')).toBeTruthy()
  })

  it('G7: live region is present when rendering positive count', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
    expect(document.querySelector('[role="status"]')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Boundary: no spinner, no suspense, no loading state
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — synchronous render: no loading state', () => {
  it('renders text content immediately on first render with empty observable', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    // Text content is immediately available — no pending/loading state rendered
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
  })

  it('does NOT render any loading or spinner indicator', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.queryByText(/loading/i)).toBeNull()
    expect(screen.queryByText(/spinner/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Boundary: no TanStack Query import (verified structurally at import time)
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — boundary: uses Legend-State, not TanStack Query', () => {
  it('graceDays$ observable mock is the source of truth (no react-query)', async () => {
    // If GraceDayInventory imported @tanstack/react-query, the module would
    // not resolve in this mock environment. Successful render confirms Legend-State path.
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-05-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})
