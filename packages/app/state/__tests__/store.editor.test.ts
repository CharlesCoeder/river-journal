// @vitest-environment happy-dom
// setFocusMode action + hasReachedAutosaveCheckpoint helper — unit tests
// RED-PHASE TDD: all tests fail before implementation.
//   - `store$.profile.editor.focusMode` field does not yet exist on UserProfile
//   - `setFocusMode` action is not yet exported from store.ts
//   - `hasReachedAutosaveCheckpoint` helper is not yet exported from store.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock Supabase client to prevent network requests ─────────────────────────
vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

// ─── Mock persistence to avoid IDB/MMKV issues in Node ───────────────────────
vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

import { store$ } from '../store'

import { setFocusMode, hasReachedAutosaveCheckpoint } from '../store'

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation: reset profile and activeFlow before each test.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store$.profile.set(null)
  store$.activeFlow.set(null)
})

afterEach(() => {
  store$.profile.set(null)
  store$.activeFlow.set(null)
})

// =============================================================================
// AC 20: setFocusMode action + default-OFF
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// FM-1: setFocusMode is exported from store.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('FM-1: setFocusMode is a callable function (AC 20)', () => {
  it('setFocusMode is exported from store as a function', () => {
    expect(typeof setFocusMode).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FM-2: setFocusMode(true) sets store$.profile.editor.focusMode to true
// ─────────────────────────────────────────────────────────────────────────────
describe('FM-2: setFocusMode(true) writes true to store$.profile.editor.focusMode (AC 20)', () => {
  it('sets editor.focusMode to true when called with true', () => {
    setFocusMode(true)
    expect(store$.profile.editor.focusMode.peek()).toBe(true)
  })

  it('creates a profile if none exists when setting focusMode to true', () => {
    expect(store$.profile.peek()).toBeNull()
    setFocusMode(true)
    expect(store$.profile.peek()).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FM-3: setFocusMode(false) sets store$.profile.editor.focusMode to false
// ─────────────────────────────────────────────────────────────────────────────
describe('FM-3: setFocusMode(false) writes false to store$.profile.editor.focusMode (AC 20)', () => {
  it('sets editor.focusMode to false when called with false', () => {
    // First set to true, then toggle back
    setFocusMode(true)
    setFocusMode(false)
    expect(store$.profile.editor.focusMode.peek()).toBe(false)
  })

  it('creates a profile and sets focusMode to false when no profile exists', () => {
    expect(store$.profile.peek()).toBeNull()
    setFocusMode(false)
    expect(store$.profile.peek()).not.toBeNull()
    expect(store$.profile.editor.focusMode.peek()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FM-4: Default profile created via ensureProfile has editor.focusMode === false
// The test calls setFocusMode(false) — which calls ensureProfile internally —
// then verifies the resulting profile shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('FM-4: Default profile has editor.focusMode === false (AC 20)', () => {
  it('newly ensured profile has editor.focusMode === false (default-OFF)', () => {
    // Trigger ensureProfile indirectly through the action
    setFocusMode(false)
    const profile = store$.profile.peek()
    expect(profile).not.toBeNull()
    expect(profile?.editor?.focusMode).toBe(false)
  })

  it('editor sub-object exists on default profile (not undefined)', () => {
    setFocusMode(false)
    const profile = store$.profile.peek()
    expect(profile?.editor).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// FM-5: Round-trip toggle — true → false → true
// ─────────────────────────────────────────────────────────────────────────────
describe('FM-5: Round-trip toggle preserves exact boolean values (AC 20)', () => {
  it('toggles correctly: true then false then true', () => {
    setFocusMode(true)
    expect(store$.profile.editor.focusMode.peek()).toBe(true)

    setFocusMode(false)
    expect(store$.profile.editor.focusMode.peek()).toBe(false)

    setFocusMode(true)
    expect(store$.profile.editor.focusMode.peek()).toBe(true)
  })
})

// =============================================================================
// AC 21: hasReachedAutosaveCheckpoint helper
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// CP-1: hasReachedAutosaveCheckpoint is exported from store.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('CP-1: hasReachedAutosaveCheckpoint is a callable function (AC 21)', () => {
  it('hasReachedAutosaveCheckpoint is exported from store as a function', () => {
    expect(typeof hasReachedAutosaveCheckpoint).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CP-2: Returns false when store$.activeFlow is null
// ─────────────────────────────────────────────────────────────────────────────
describe('CP-2: returns false when activeFlow is null (AC 21)', () => {
  it('returns false when store$.activeFlow === null', () => {
    store$.activeFlow.set(null)
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CP-3: Returns false when activeFlow.content is whitespace-only
// ─────────────────────────────────────────────────────────────────────────────
describe('CP-3: returns false when activeFlow.content is whitespace-only (AC 21)', () => {
  it('returns false when content is a single space', () => {
    store$.activeFlow.set({ content: ' ', wordCount: 0 })
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })

  it('returns false when content is multiple spaces', () => {
    store$.activeFlow.set({ content: '   ', wordCount: 0 })
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })

  it('returns false when content is a tab character', () => {
    store$.activeFlow.set({ content: '\t', wordCount: 0 })
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })

  it('returns false when content is newlines only', () => {
    store$.activeFlow.set({ content: '\n\n', wordCount: 0 })
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })

  it('returns false for the exact AC21 whitespace fixture: content="   " wordCount=0', () => {
    store$.activeFlow.set({ content: '   ', wordCount: 0 })
    expect(hasReachedAutosaveCheckpoint()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CP-4: Returns true when activeFlow.content has real text
// ─────────────────────────────────────────────────────────────────────────────
describe('CP-4: returns true when activeFlow.content has real text (AC 21)', () => {
  it('returns true for the exact AC21 real-content fixture: content="real words" wordCount=2', () => {
    store$.activeFlow.set({ content: 'real words', wordCount: 2 })
    expect(hasReachedAutosaveCheckpoint()).toBe(true)
  })

  it('returns true for a single non-whitespace word', () => {
    store$.activeFlow.set({ content: 'hello', wordCount: 1 })
    expect(hasReachedAutosaveCheckpoint()).toBe(true)
  })

  it('returns true for content with leading/trailing whitespace but non-empty core', () => {
    store$.activeFlow.set({ content: '  hello world  ', wordCount: 2 })
    expect(hasReachedAutosaveCheckpoint()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CP-5: Type-safety guard — activeFlow has no `id` field (documentation test)
// This test documents the contract: hasReachedAutosaveCheckpoint must NOT
// reference active?.id (which is always undefined on this type) — failing here
// means the helper has incorrect type assumptions.
// ─────────────────────────────────────────────────────────────────────────────
describe('CP-5: activeFlow type shape — content+wordCount only (AC 21 type-safety guard)', () => {
  it('activeFlow type has content and wordCount but no id', () => {
    // Set a valid activeFlow with the documented shape
    store$.activeFlow.set({ content: 'some text', wordCount: 2 })
    const active = store$.activeFlow.peek()
    expect(active).not.toBeNull()
    expect(typeof active?.content).toBe('string')
    expect(typeof active?.wordCount).toBe('number')
    // id is NOT on the type — this asserting undefined documents the contract
    expect((active as any)?.id).toBeUndefined()
  })

  it('hasReachedAutosaveCheckpoint returns true even when checking a content-only shape', () => {
    // Guard against an impl that accidentally uses ?.id which would silently return false
    store$.activeFlow.set({ content: 'type-safe content', wordCount: 3 })
    expect(hasReachedAutosaveCheckpoint()).toBe(true)
  })
})
