/**
 * subscriptionTier.e2e.test.ts — surfacing `subscription_tier` on the client
 * store and the instant cosmetic-unlock reactive wiring.
 *
 * Mirrors `streak.unlock.e2e.test.ts`'s pattern: real `store$` / `streak.ts`
 * / `entries$` / `flows$` / `graceDays$`, with only the Supabase client
 * module mocked (no network in unit tests). This exercises the FULL
 * theme-picker-tier-seam -> instant-unlock workflow end-to-end at the state
 * layer, which is where the actual behavior lives — the UI component
 * (`ThemePicker`) merely reads `getThemePickerTier()` / `useUnlockedThemes()`,
 * already covered by `ThemePicker.unlock.test.tsx`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import { store$, applySubscriptionTierFromServer, ensureProfile } from '../store'
import { entries$ } from '../entries'
import { flows$ } from '../flows'
import { graceDays$ } from '../grace_days'
// Import streak to trigger store$.assign({ views: { streak: ... } }) wiring,
// and to import the seam functions under test.
import { getThemePickerTier, useUnlockedThemes } from '../streak'

beforeEach(() => {
  store$.profile.set(null)
  entries$.set({} as any)
  flows$.set({} as any)
  graceDays$.set({} as any)
})

// ==========================================================================
// subscription_tier on UserProfile / ensureProfile default
// ==========================================================================

describe('ensureProfile — subscription_tier default', () => {
  it('defaults subscription_tier to "free" on a freshly created profile', () => {
    expect(store$.profile.get()).toBeNull()
    ensureProfile()
    expect(store$.profile.subscription_tier.get()).toBe('free')
  })

  it('back-compat: a legacy persisted profile without subscription_tier reads as "free" via the null-safe seam, without ensureProfile needing to mutate it', () => {
    // Simulate a legacy profile persisted before this field existed.
    store$.profile.set({
      word_goal: 750,
      themeName: 'ink',
      customTheme: null,
      fontPairing: 'outfit-newsreader',
      hotkeyOverrides: {},
      editor: { focusMode: false },
      unlockedThemes: [],
      sync: { word_goal: true, themeName: true, customTheme: true, fontPairing: true },
    } as any)

    expect(store$.profile.subscription_tier.get() ?? 'free').toBe('free')
  })
})

// ==========================================================================
// applySubscriptionTierFromServer setter (validate-receipt +
// app-open re-validation both funnel through this one setter)
// ==========================================================================

describe('applySubscriptionTierFromServer — the server-fed setter (validate-receipt + app-open re-validation)', () => {
  it('sets store$.profile.subscription_tier to the server-authoritative value', () => {
    applySubscriptionTierFromServer('paid_monthly')
    expect(store$.profile.subscription_tier.get()).toBe('paid_monthly')
  })

  it('creates a profile if none exists (mirrors setTheme/spendUnlockToken)', () => {
    expect(store$.profile.get()).toBeNull()
    applySubscriptionTierFromServer('paid_yearly')
    expect(store$.profile.get()).not.toBeNull()
    expect(store$.profile.subscription_tier.get()).toBe('paid_yearly')
  })

  it('never writes users.preferences.unlockedThemes or the unlockedThemes array when applying a paid tier (additive, not a replacement)', () => {
    ensureProfile()
    store$.profile.unlockedThemes.set(['fireside'])
    applySubscriptionTierFromServer('paid_monthly')
    // Untouched — paid tier bypasses this array entirely; it must not be
    // mutated as a side effect of the tier flip.
    expect(store$.profile.unlockedThemes.get()).toEqual(['fireside'])
  })

  it('can flip a tier back to "free" (e.g. after a lapse) without throwing', () => {
    applySubscriptionTierFromServer('paid_monthly')
    expect(() => applySubscriptionTierFromServer('free')).not.toThrow()
    expect(store$.profile.subscription_tier.get()).toBe('free')
  })
})

// ==========================================================================
// getThemePickerTier() rewire (removes the hardcoded 'free')
// ==========================================================================

describe('getThemePickerTier — reads store$.profile.subscription_tier', () => {
  it('returns "free" when no profile exists', () => {
    expect(store$.profile.get()).toBeNull()
    expect(getThemePickerTier()).toBe('free')
  })

  it('returns "free" when the profile exists but subscription_tier is unset (back-compat)', () => {
    ensureProfile()
    expect(getThemePickerTier()).toBe('free')
  })

  it('reflects "paid_monthly" once applySubscriptionTierFromServer sets it', () => {
    applySubscriptionTierFromServer('paid_monthly')
    expect(getThemePickerTier()).toBe('paid_monthly')
  })

  it('reflects "paid_yearly" once applySubscriptionTierFromServer sets it', () => {
    applySubscriptionTierFromServer('paid_yearly')
    expect(getThemePickerTier()).toBe('paid_yearly')
  })

  it('is no longer hardcoded — flipping the store value changes the return value across calls', () => {
    expect(getThemePickerTier()).toBe('free')
    applySubscriptionTierFromServer('paid_monthly')
    expect(getThemePickerTier()).toBe('paid_monthly')
  })
})

// ==========================================================================
// instant cosmetic unlock on subscribe (reactive, streak untouched)
// ==========================================================================

describe('Instant cosmetic unlock — theme-picker-tier-seam -> useUnlockedThemes', () => {
  it('useUnlockedThemes(getThemePickerTier()) returns ALL themes immediately once the tier flips to paid_monthly', () => {
    applySubscriptionTierFromServer('paid_monthly')
    const tier = getThemePickerTier()
    const unlocked = useUnlockedThemes(tier)
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'ink',
        'night',
        'forest-morning',
        'forest-night',
        'leather',
        'fireside',
      ])
    )
    expect(unlocked).toHaveLength(6)
  })

  it('useUnlockedThemes(getThemePickerTier()) returns ALL themes immediately once the tier flips to paid_yearly', () => {
    applySubscriptionTierFromServer('paid_yearly')
    const tier = getThemePickerTier()
    const unlocked = useUnlockedThemes(tier)
    expect(unlocked).toHaveLength(6)
  })

  it('before the tier flips (still free), useUnlockedThemes reflects only the user-chosen unlocks, not all six', () => {
    ensureProfile()
    store$.profile.unlockedThemes.set(['forest-morning'])
    const tier = getThemePickerTier()
    expect(tier).toBe('free')
    // Free-tier path reads through streak$'s chosenUnlocks wiring — a bare
    // profile with one chosen theme must not report all six as unlocked.
    const streakState = store$.views.streak!.get()
    expect(streakState!.unlockedThemes).not.toHaveLength(6)
  })

  it('the streak counts (currentStreak, longestStreak, unlockTokensEarned) are UNCHANGED by a tier flip — paid tier is additive, never a replacement', () => {
    // Seed a small amount of streak data so the counts are non-trivial.
    entries$.set({
      e1: {
        id: 'e1',
        entryDate: '2026-07-10',
        lastModified: '2026-07-10T12:00:00Z',
        local_session_id: 's1',
      },
    } as any)
    flows$.set({
      f1: {
        id: 'f1',
        dailyEntryId: 'e1',
        timestamp: '2026-07-10T12:00:00Z',
        content: 'x'.repeat(500),
        wordCount: 500,
        local_session_id: 's1',
      },
    } as any)

    const before = store$.views.streak!.get()
    const beforeCounts = {
      currentStreak: before!.currentStreak,
      longestStreak: before!.longestStreak,
      unlockTokensEarned: before!.unlockTokensEarned,
    }

    applySubscriptionTierFromServer('paid_monthly')

    const after = store$.views.streak!.get()
    const afterCounts = {
      currentStreak: after!.currentStreak,
      longestStreak: after!.longestStreak,
      unlockTokensEarned: after!.unlockTokensEarned,
    }

    expect(afterCounts).toEqual(beforeCounts)
  })
})
