// @vitest-environment happy-dom
// GraceDayInventory — filter logic, rendering states, and accessibility

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { GraceDay } from 'app/state/types'

// ─── Mock @legendapp/state/react — synchronous use$ snapshot ─────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: { get: () => unknown }) => obs.get(),
}))

// ─── Stub graceDays$ observable — seeded per-test in beforeEach ──────────────
// vi.hoisted runs before imports, so we import observable() inside the factory.
const { graceDays$ } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { observable } = require('@legendapp/state')
  return { graceDays$: observable({} as Record<string, GraceDay>) }
})
vi.mock('app/state/grace_days', () => ({
  graceDays$,
}))

// ─── Mock @my/ui — forward a11y + content props to HTML elements ─────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const mapped: Record<string, unknown> = {}
    if (props.testID) mapped['data-testid'] = props.testID
    if (props.role) mapped['role'] = props.role
    if (props['aria-label']) mapped['aria-label'] = props['aria-label']
    if (props['aria-live']) mapped['aria-live'] = props['aria-live']
    if (props.accessibilityLabel) mapped['aria-label'] = props.accessibilityLabel
    if (props.accessibilityRole) mapped['role'] = props.accessibilityRole
    return mapped
  }

  const makeTag =
    (tag: keyof HTMLElementTagNameMap) =>
    ({ children, ...rest }: any) =>
      ReactModule.createElement(tag, mapProps(rest as any), children)

  return {
    Text: makeTag('span'),
    View: makeTag('div'),
    YStack: makeTag('div'),
  }
})

import { GraceDayInventory } from '../GraceDayInventory'

afterEach(cleanup)

beforeEach(() => {
  graceDays$.set({})
})

// ─────────────────────────────────────────────────────────────────────────────
// G1 — Zero state: empty record renders calm "No grace days yet." text
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G1: zero state (empty record)', () => {
  it('G1a: renders "No grace days yet." when no grace days exist', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('No grace days yet.')).toBeTruthy()
  })

  it('G1b: does NOT render "available" copy when zero grace days exist', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    expect(screen.queryByText(/available/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G2 — One available grace day: singular form
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G2: one available grace day (singular)', () => {
  it('G2: renders "1 grace day available." (singular) when one available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G3 — Multiple available grace days: plural form
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G3: multiple available grace days (plural)', () => {
  it('G3: renders "3 grace days available." (plural) when three available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-04-15T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
      g3: { id: 'g3', userId: 'u1', earnedAt: '2026-04-20T00:00:00Z', earnedForMilestone: 90, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('3 grace days available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G4 — Used grace day excluded from count
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G4: used grace day is excluded from inventory', () => {
  it('G4: renders "1 grace day available." when one spent + one unspent', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: '2026-04-15' },
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-04-15T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G5 — Soft-deleted grace day excluded from count
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G5: soft-deleted grace day is excluded from inventory', () => {
  it('G5: renders "1 grace day available." when one deleted + one available', () => {
    graceDays$.set({
      // is_deleted is not on GraceDay type — cast to any to set it (defensive filter at consumer site)
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null, is_deleted: true } as any,
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-04-15T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G6 — Mixed states: deleted + spent + available
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G6: mixed row states (deleted + spent + available)', () => {
  it('G6: renders "1 grace day available." with one deleted, one spent, one available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-03-15T00:00:00Z', earnedForMilestone: 7, usedForDate: null, is_deleted: true } as any,
      g2: { id: 'g2', userId: 'u1', earnedAt: '2026-03-20T00:00:00Z', earnedForMilestone: 7, usedForDate: '2026-04-01' },
      g3: { id: 'g3', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 30, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    expect(screen.getByText('1 grace day available.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// G7 — Accessibility: aria-live status region
// ─────────────────────────────────────────────────────────────────────────────
describe('GraceDayInventory — G7: accessibility aria-live status region', () => {
  it('G7a: wrapping element has role="status"', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    const region = screen.getByRole('status')
    expect(region).toBeTruthy()
  })

  it('G7b: wrapping element has aria-live="polite"', () => {
    graceDays$.set({})
    render(React.createElement(GraceDayInventory))
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('G7c: status region is present when grace days are available', () => {
    graceDays$.set({
      g1: { id: 'g1', userId: 'u1', earnedAt: '2026-04-01T00:00:00Z', earnedForMilestone: 7, usedForDate: null },
    })
    render(React.createElement(GraceDayInventory))
    const region = screen.getByRole('status')
    expect(region).toBeTruthy()
    expect(region.getAttribute('aria-live')).toBe('polite')
  })
})
