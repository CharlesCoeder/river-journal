/**
 * Regression test for the `subscription_tier` enum in `packages/app/types/database.ts`.
 *
 * `database.ts` is hand-maintained (not auto-regenerated from the live
 * schema), and its type-level `Enums` block and runtime `Constants` export
 * are independent — `yarn typecheck` will NOT catch a missing runtime
 * `Constants.public.Enums.subscription_tier` array entry even after the
 * type-level `Enums['subscription_tier']` union is added. This test exists
 * specifically to catch that silent-drift failure mode at the one layer
 * that can: a runtime assertion.
 *
 * Coverage:
 *   - `Constants.public.Enums.subscription_tier` exists and lists exactly
 *     the three tiers, in the ADD COLUMN default-compatible order
 *     `['free', 'paid_monthly', 'paid_yearly']` (mirrors the existing
 *     `encryption_mode` Constants entry).
 *
 * Without the runtime array entry, `Constants.public.Enums.subscription_tier`
 * is `undefined` and the `toEqual` assertion below fails — which is exactly the
 * silent-drift case this test guards against.
 */
import { describe, it, expect } from 'vitest'
import { Constants } from '../database'

describe('database.ts Constants.public.Enums.subscription_tier', () => {
  it('lists all three subscription tiers as a runtime array', () => {
    expect(Constants.public.Enums.subscription_tier).toEqual([
      'free',
      'paid_monthly',
      'paid_yearly',
    ])
  })
})
