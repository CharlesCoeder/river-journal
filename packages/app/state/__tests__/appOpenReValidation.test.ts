/**
 * appOpenReValidation.test.ts — the app-open entitlement re-validation is
 * deferred until a session is known, so it never fires before the JWT exists
 * on a cold boot (which would 401 as a silent no-op).
 *
 * The re-validation helper itself is covered in
 * `utils/billing/__tests__/subscriptionApi.test.ts`; this file only asserts the
 * session-known gate that guards WHEN it runs.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

const reValidateSpy = vi.fn()
let mockReceipt: unknown = { provider: 'stripe', raw_receipt: 'cs_stored' }

vi.mock('../billing', () => ({
  getStoredReceipt: () => mockReceipt,
}))

vi.mock('../../utils/billing/subscriptionApi', () => ({
  reValidateStoredReceiptOnAppOpen: (...args: unknown[]) => reValidateSpy(...args),
}))

import { store$ } from '../store'
import { scheduleAppOpenReValidation } from '../appOpenReValidation'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  reValidateSpy.mockReset()
  mockReceipt = { provider: 'stripe', raw_receipt: 'cs_stored' }
  store$.session.userId.set(null)
})

describe('scheduleAppOpenReValidation — deferred until a session is known', () => {
  // NOTE: a single scheduleAppOpenReValidation() registration per test — a
  // registration left pending (session still null) keeps watching the shared
  // store singleton, so registering twice would double-fire on the transition.
  it('stays deferred while the session userId is null, then re-validates once it becomes known', async () => {
    scheduleAppOpenReValidation()
    await flush()
    // Nothing yet — the JWT is not available until a session exists.
    expect(reValidateSpy).not.toHaveBeenCalled()

    store$.session.userId.set('user-uuid-abc123')
    await flush()

    expect(reValidateSpy).toHaveBeenCalledTimes(1)
    // Forwards the stored receipt to the re-validation helper.
    expect(reValidateSpy.mock.calls[0]?.[0]).toEqual({
      provider: 'stripe',
      raw_receipt: 'cs_stored',
    })
  })

  it('fires immediately when a session is already hydrated at call time', async () => {
    store$.session.userId.set('user-uuid-already')
    scheduleAppOpenReValidation()
    await flush()
    expect(reValidateSpy).toHaveBeenCalledTimes(1)
  })
})
