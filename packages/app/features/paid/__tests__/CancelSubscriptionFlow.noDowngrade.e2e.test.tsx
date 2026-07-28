// @vitest-environment happy-dom
/**
 * CancelSubscriptionFlow.noDowngrade.e2e.test.tsx — proves the cancel flow
 * NEVER writes an early downgrade to the client store.
 *
 * Mirrors `state/__tests__/subscriptionTier.e2e.test.ts`'s pattern: the REAL
 * `store$` / `streak.ts` state layer is used (only the Supabase client module
 * is mocked — no network in unit tests), so this is a genuine end-to-end
 * proof at the state layer, not a mock assertion. The tier flip to 'free' is
 * exclusively server-owned (the `expire_lapsed_subscription_tiers()` sweep) —
 * this file exercises the REAL CancelSubscriptionFlow component through a
 * full confirm -> success workflow and asserts `subscription_tier`,
 * `unlockedThemes`, and every streak count are BYTE-IDENTICAL before and
 * after, on both the Stripe and the Apple/Play path.
 *
 * Only `app/utils/billing/subscriptionApi`'s `cancelSubscription` is mocked
 * (the network boundary) — everything downstream of the confirm tap runs for
 * real against the real store.
 *
 * Red-phase: `packages/app/features/paid/CancelSubscriptionFlow.tsx` does not
 * exist yet — this file fails at the top-level import until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('app/utils/supabase', () => ({
  supabase: {},
}))

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
}))

const cancelSubscriptionMock = vi.fn()
vi.mock('app/utils/billing/subscriptionApi', () => ({
  cancelSubscription: (args: unknown) => cancelSubscriptionMock(args),
}))

// ─── @my/ui mock — minimal passthrough, enough to drive the workflow ──────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const DialogPortal = ({ children }: any) => ReactModule.createElement('div', {}, children)
  const DialogOverlay = () => ReactModule.createElement('div', {})
  const DialogContent = ({ children }: any) => ReactModule.createElement('div', {}, children)
  const DialogTitle = ({ children }: any) => ReactModule.createElement('h2', {}, children)
  const DialogDescription = ({ children }: any) => ReactModule.createElement('p', {}, children)
  const DialogComponent = ({ children, open }: any) =>
    ReactModule.createElement('div', { role: open ? 'dialog' : undefined }, open ? children : null)
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
  })

  return {
    Text: ({ children }: any) => ReactModule.createElement('span', {}, children),
    XStack: ({ children }: any) => ReactModule.createElement('div', {}, children),
    YStack: ({ children }: any) => ReactModule.createElement('div', {}, children),
    Dialog: DialogComponent,
    ExpandingLineButton: ({ children, onPress, disabled }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: disabled ? undefined : onPress,
          disabled: !!disabled,
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until CancelSubscriptionFlow.tsx exists ────
import { CancelSubscriptionFlow } from '../CancelSubscriptionFlow'

// ─── REAL store — the actual state layer under test ────────────────────────
import { store$, ensureProfile } from 'app/state/store'
import { entries$ } from 'app/state/entries'
import { flows$ } from 'app/state/flows'
import { graceDays$ } from 'app/state/grace_days'
// Side-effect import: wires store$.views.streak (attached at streak.ts module
// load) so the entitlement snapshot can read the derived streak counts.
import 'app/state/streak'

beforeEach(() => {
  store$.profile.set(null)
  entries$.set({} as any)
  flows$.set({} as any)
  graceDays$.set({} as any)
  cancelSubscriptionMock.mockReset()

  ensureProfile()
  store$.profile.subscription_tier.set('paid_monthly')
  store$.profile.unlockedThemes.set(['fireside'])

  // Seed a little streak-relevant journal data so the counts are non-trivial.
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
})

afterEach(() => {
  cleanup()
})

function snapshotEntitlementState() {
  const streak = store$.views.streak!.get()
  return {
    subscription_tier: store$.profile.subscription_tier.get(),
    unlockedThemes: store$.profile.unlockedThemes.get(),
    currentStreak: streak!.currentStreak,
    longestStreak: streak!.longestStreak,
    unlockTokensEarned: streak!.unlockTokensEarned,
  }
}

describe('Stripe cancel success leaves tier/streak/unlockedThemes unwritten', () => {
  it('subscription_tier, unlockedThemes, and every streak count are byte-identical before and after a successful cancel', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    const before = snapshotEntitlementState()

    render(
      React.createElement(CancelSubscriptionFlow, {
        open: true,
        onOpenChange: vi.fn(),
        provider: 'stripe',
        subscriptionId: 'sub_test_123',
        currentPeriodEnd: '2026-08-14T00:00:00.000Z',
        onCancelled: vi.fn(),
      })
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledTimes(1)
    })

    const after = snapshotEntitlementState()
    expect(after).toEqual(before)
    // Explicit, unambiguous assertions (not just equality-of-snapshot) — the
    // tier must still read 'paid_monthly' immediately after a successful
    // cancel; the flip to 'free' is a separate, server-owned, out-of-request
    // process this component must never anticipate client-side.
    expect(store$.profile.subscription_tier.get()).toBe('paid_monthly')
    expect(store$.profile.unlockedThemes.get()).toEqual(['fireside'])
  })
})

describe('Apple/Play cancel success (native-action) also leaves tier/streak/unlockedThemes unwritten', () => {
  it('subscription_tier, unlockedThemes, and every streak count are byte-identical before and after', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-09-01T00:00:00Z',
      requires_native_action: true,
    })

    const before = snapshotEntitlementState()

    render(
      React.createElement(CancelSubscriptionFlow, {
        open: true,
        onOpenChange: vi.fn(),
        provider: 'apple_iap',
        subscriptionId: '1000000123456789',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
        onCancelled: vi.fn(),
      })
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledTimes(1)
    })

    const after = snapshotEntitlementState()
    expect(after).toEqual(before)
  })
})

describe('A failed cancel also leaves tier/streak/unlockedThemes unwritten', () => {
  it('an error response never touches store$.profile.subscription_tier / unlockedThemes / streak state', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    const before = snapshotEntitlementState()

    render(
      React.createElement(CancelSubscriptionFlow, {
        open: true,
        onOpenChange: vi.fn(),
        provider: 'stripe',
        subscriptionId: 'sub_test_123',
        currentPeriodEnd: '2026-08-14T00:00:00.000Z',
        onCancelled: vi.fn(),
      })
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledTimes(1)
    })

    const after = snapshotEntitlementState()
    expect(after).toEqual(before)
  })
})
