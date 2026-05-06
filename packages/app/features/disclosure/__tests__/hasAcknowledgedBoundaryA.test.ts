// hasAcknowledgedBoundaryA helper — RED-PHASE TDD
// ALL tests MUST FAIL before implementation of
// packages/app/features/disclosure/ThreePostureDisclosure.tsx
// (or packages/app/features/disclosure/hasAcknowledged.ts)
//
// Story 3-6 AC covered: 15, 26

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock supabase so the store can be imported without network I/O ──────────
vi.mock('app/utils/supabase', () => ({ supabase: {} }))
vi.mock('../../utils/supabase', () => ({ supabase: {} }))

import { store$ } from 'app/state/store'

// ─── Import under test ───────────────────────────────────────────────────────
// WILL FAIL until the helper is exported from the wrapper module.
import { hasAcknowledgedBoundaryA } from '../ThreePostureDisclosure'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation — reset profile preferences between each test
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  // Wipe the whole profile so preferences is undefined (covers "missing" case)
  store$.profile.set(null)
})

// =============================================================================
// AC #26: hasAcknowledgedBoundaryA state cases
// =============================================================================

describe('AC26 — hasAcknowledgedBoundaryA — returns false when unset', () => {
  it('returns false when store$.profile is null (no profile)', () => {
    // profile is null from beforeEach reset
    expect(hasAcknowledgedBoundaryA()).toBe(false)
  })

  it('returns false when preferences is undefined (profile exists but no preferences key)', () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      // No preferences field
    })
    expect(hasAcknowledgedBoundaryA()).toBe(false)
  })

  it('returns false when preferences.disclosures is undefined', () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      preferences: {},
    })
    expect(hasAcknowledgedBoundaryA()).toBe(false)
  })

  it('returns false when preferences.disclosures.collective_post_v1 is undefined', () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      preferences: {
        disclosures: {},
      },
    })
    expect(hasAcknowledgedBoundaryA()).toBe(false)
  })
})

describe('AC26 — hasAcknowledgedBoundaryA — returns true when acknowledged_at is set', () => {
  it('returns true when acknowledged_at is a non-empty ISO string', () => {
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
      preferences: {
        disclosures: {
          collective_post_v1: { acknowledged_at: '2026-05-06T12:00:00.000Z' },
        },
      },
    })
    expect(hasAcknowledgedBoundaryA()).toBe(true)
  })

  it('returns true immediately after the wrapper writes acknowledged_at (synchronous read)', () => {
    // Simulate the write path the wrapper uses
    store$.profile.set({
      word_goal: 500,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      sync: { word_goal: false, themeName: false, customTheme: false, fontPairing: false },
    })
    const now = new Date().toISOString()
    // Write via same deep-set path the wrapper uses
    store$.profile.preferences.disclosures.collective_post_v1.set({ acknowledged_at: now })

    expect(hasAcknowledgedBoundaryA()).toBe(true)
  })

  it('is synchronous — returns boolean without async work', () => {
    const result = hasAcknowledgedBoundaryA()
    // Must be a plain boolean, not a Promise
    expect(typeof result).toBe('boolean')
    expect(result === true || result === false).toBe(true)
  })
})

describe('AC26 — hasAcknowledgedBoundaryA — module export', () => {
  it('is exported as a named function from the wrapper module', async () => {
    const mod = await import('../ThreePostureDisclosure')
    expect(typeof mod.hasAcknowledgedBoundaryA).toBe('function')
  })
})
