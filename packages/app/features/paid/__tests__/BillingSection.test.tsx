// @vitest-environment happy-dom
/**
 * BillingSection.test.tsx — the Billing surface reachable from Settings:
 * status + period-end + Cancel affordance, gated to paid-tier users, hosting
 * the CancelSubscriptionFlow dialog.
 *
 * Drives the full workflow a user sees inside Settings: paid-tier gate,
 * syncing/no-receipt branch, the populated status+Cancel row, opening the
 * cancel dialog with the correct receipt-row pair, and the post-cancel
 * "access continues" microcopy. `CancelSubscriptionFlow` itself is mocked at
 * the module boundary — its own state machine is independently covered in
 * `CancelSubscriptionFlow.test.tsx`; this file only asserts BillingSection
 * wires it with the correct props and reacts correctly to `onCancelled`.
 *
 * Contract pinned for the green-phase implementer:
 *   `packages/app/features/paid/BillingSection.tsx` exports `BillingSection`
 *   — a self-contained component (no props; reads `store$.profile
 *   .subscription_tier` and `store$.session.userId` itself, mirroring
 *   `PaidTierPurchaseSurface`'s own internal userId read) that:
 *     - renders null when `subscription_tier` is not `paid_monthly` /
 *       `paid_yearly` (the `SuspensionStatusSection` self-null pattern);
 *     - reads `useSubscriptionReceipt(userId)`;
 *     - shows "Subscription details are syncing." with NO Cancel affordance
 *       when the receipt is null;
 *     - otherwise shows the receipt's status, the formatted
 *       `current_period_end`, and a "Cancel subscription"
 *       `ExpandingLineButton size="default"` that opens
 *       `CancelSubscriptionFlow` with
 *       `{ provider, subscriptionId: provider_subscription_id,
 *         currentPeriodEnd: current_period_end }` from the receipt row;
 *     - once the receipt's status is 'canceled', shows the small
 *       "Your access continues until [date]" microcopy in place of the
 *       Cancel affordance (the cancellation already happened; nothing left
 *       to cancel).
 *
 * Red-phase: `packages/app/features/paid/BillingSection.tsx` does not exist
 * yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Mutable mock state ─────────────────────────────────────────────────────
let mockTier: 'free' | 'paid_monthly' | 'paid_yearly' = 'paid_monthly'
let mockUserId: string | null = 'user-uuid-abc123'
let mockReceipt: {
  provider: 'stripe' | 'apple_iap' | 'play_iap'
  provider_subscription_id: string
  status: 'active' | 'pending' | 'canceled' | 'past_due' | 'expired'
  current_period_end: string
} | null = {
  provider: 'stripe',
  provider_subscription_id: 'sub_test_123',
  status: 'active',
  current_period_end: '2026-08-14T00:00:00.000Z',
}

const useSubscriptionReceiptMock = vi.fn((_userId: string | null) => mockReceipt)

// ─── @legendapp/state/react — use$() reads observable.get() synchronously ──
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => {
    if (obs && typeof obs.get === 'function') return obs.get()
    return obs
  },
}))

// ─── app/state/store — nested-getter pattern (mirrors PaidTierPurchaseSurface.test.tsx) ──
vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      get subscription_tier() {
        return { get: () => mockTier }
      },
    },
    session: {
      get userId() {
        return { get: () => mockUserId }
      },
    },
  },
}))

// ─── app/state/subscriptionReceipt — independently covered elsewhere ───────
vi.mock('app/state/subscriptionReceipt', () => ({
  useSubscriptionReceipt: (userId: string | null) => useSubscriptionReceiptMock(userId),
}))

// ─── ../CancelSubscriptionFlow — its own state machine is covered elsewhere ─
const cancelFlowPropsSpy = vi.fn()
vi.mock('../CancelSubscriptionFlow', async () => {
  const ReactModule = await import('react')
  return {
    CancelSubscriptionFlow: (props: any) => {
      cancelFlowPropsSpy(props)
      if (!props.open) return null
      return ReactModule.createElement(
        'div',
        { 'data-testid': 'cancel-flow-stub' },
        ReactModule.createElement(
          'button',
          { 'data-testid': 'cancel-flow-stub-cancelled', onClick: () => props.onCancelled() },
          'stub-fire-onCancelled'
        ),
        // The Done button models the terminal Stripe acknowledgment closing the
        // dialog via onOpenChange(false) — used by the done-ack teardown test.
        ReactModule.createElement(
          'button',
          { 'data-testid': 'cancel-flow-stub-done', onClick: () => props.onOpenChange(false) },
          'stub-fire-done'
        )
      )
    },
  }
})

// ─── @my/ui mock ────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  return {
    Text: ({ children }: any) => ReactModule.createElement('span', {}, children),
    XStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    ExpandingLineButton: ({ children, onPress, size }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          'data-size': size ?? 'default',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
  }
})

// ─── Import under test — fails until BillingSection.tsx exists ────────────
import { BillingSection } from '../BillingSection'

const MONTHS =
  /January|February|March|April|May|June|July|August|September|October|November|December/

beforeEach(() => {
  mockTier = 'paid_monthly'
  mockUserId = 'user-uuid-abc123'
  mockReceipt = {
    provider: 'stripe',
    provider_subscription_id: 'sub_test_123',
    status: 'active',
    current_period_end: '2026-08-14T00:00:00.000Z',
  }
  useSubscriptionReceiptMock.mockClear()
  cancelFlowPropsSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Free-tier gate — renders nothing', () => {
  it('renders null when subscription_tier is "free"', () => {
    mockTier = 'free'
    const { container } = render(React.createElement(BillingSection))
    expect(container.firstChild).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Paid tier + populated receipt — status, period end, Cancel affordance', () => {
  it('renders for paid_monthly', () => {
    mockTier = 'paid_monthly'
    render(React.createElement(BillingSection))
    expect(screen.getByTestId('btn-cancel-subscription')).toBeTruthy()
  })

  it('renders for paid_yearly', () => {
    mockTier = 'paid_yearly'
    render(React.createElement(BillingSection))
    expect(screen.getByTestId('btn-cancel-subscription')).toBeTruthy()
  })

  it('renders the receipt status text', () => {
    render(React.createElement(BillingSection))
    expect(screen.getByText(/active/i)).toBeTruthy()
  })

  it('renders the formatted current_period_end (a human month-name date)', () => {
    render(React.createElement(BillingSection))
    expect(screen.getByText(MONTHS)).toBeTruthy()
  })

  it('renders a "Cancel subscription" ExpandingLineButton at body density (size="default")', () => {
    render(React.createElement(BillingSection))
    const button = screen.getByTestId('btn-cancel-subscription')
    expect(button.getAttribute('data-size')).toBe('default')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Paid tier + null receipt — "syncing", no Cancel affordance', () => {
  it('shows "Subscription details are syncing." when the receipt hook resolves null', () => {
    mockReceipt = null
    render(React.createElement(BillingSection))
    expect(screen.getByText('Subscription details are syncing.')).toBeTruthy()
  })

  it('renders NO Cancel subscription affordance when the receipt is null', () => {
    mockReceipt = null
    render(React.createElement(BillingSection))
    expect(screen.queryByTestId('btn-cancel-subscription')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Opening the cancel dialog — correct receipt-row pair wired through', () => {
  it('tapping "Cancel subscription" opens CancelSubscriptionFlow with the receipt provider/subscription pair', () => {
    mockReceipt = {
      provider: 'apple_iap',
      provider_subscription_id: '1000000123456789',
      status: 'active',
      current_period_end: '2026-09-01T00:00:00.000Z',
    }
    render(React.createElement(BillingSection))
    fireEvent.click(screen.getByTestId('btn-cancel-subscription'))

    expect(screen.getByTestId('cancel-flow-stub')).toBeTruthy()
    const lastCall = cancelFlowPropsSpy.mock.calls[cancelFlowPropsSpy.mock.calls.length - 1]![0]
    expect(lastCall.open).toBe(true)
    expect(lastCall.provider).toBe('apple_iap')
    expect(lastCall.subscriptionId).toBe('1000000123456789')
    expect(lastCall.currentPeriodEnd).toBe('2026-09-01T00:00:00.000Z')
  })

  it('the dialog is closed (not mounted-open) before Cancel subscription is tapped', () => {
    render(React.createElement(BillingSection))
    expect(screen.queryByTestId('cancel-flow-stub')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Post-cancel — "access continues" microcopy', () => {
  it('shows "Your access continues until [date]" when the receipt status is canceled', () => {
    mockReceipt = {
      provider: 'stripe',
      provider_subscription_id: 'sub_test_123',
      status: 'canceled',
      current_period_end: '2026-08-14T00:00:00.000Z',
    }
    render(React.createElement(BillingSection))
    expect(screen.getByText(/your access continues until/i)).toBeTruthy()
    expect(screen.getByText(MONTHS)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Done-ack teardown — the terminal screen is not preempted by the refetch', () => {
  it('success → refetch flips status to canceled → dialog STAYS mounted until Done, then tears down with no stale open', () => {
    // Start on a live active Stripe receipt.
    mockReceipt = {
      provider: 'stripe',
      provider_subscription_id: 'sub_test_123',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00.000Z',
    }
    const { rerender } = render(React.createElement(BillingSection))

    // Open the cancel dialog.
    fireEvent.click(screen.getByTestId('btn-cancel-subscription'))
    expect(screen.getByTestId('cancel-flow-stub')).toBeTruthy()

    // The cancel succeeds: the flow fires onCancelled(), which invalidates the
    // receipt query so the surface will refetch.
    fireEvent.click(screen.getByTestId('cancel-flow-stub-cancelled'))

    // The refetch lands — the row now reads status='canceled' with a fresh
    // period end. Re-render to model that update propagating.
    mockReceipt = {
      provider: 'stripe',
      provider_subscription_id: 'sub_test_123',
      status: 'canceled',
      current_period_end: '2026-08-14T00:00:00.000Z',
    }
    rerender(React.createElement(BillingSection))

    // The dialog is STILL mounted — the terminal "Cancelled. Thanks for being
    // here." + Done acknowledgment is not preempted by the isCanceled flip.
    expect(screen.queryByTestId('cancel-flow-stub')).toBeTruthy()
    const openCall = cancelFlowPropsSpy.mock.calls[cancelFlowPropsSpy.mock.calls.length - 1]![0]
    expect(openCall.open).toBe(true)

    // The user presses Done — the dialog closes via onOpenChange(false).
    fireEvent.click(screen.getByTestId('cancel-flow-stub-done'))

    // Teardown: the dialog unmounts (proving cancelOpen was reset — a stale
    // cancelOpen=true would keep it mounted since the gate is
    // `cancelOpen || !isCanceled`), and the "access continues" microcopy shows.
    expect(screen.queryByTestId('cancel-flow-stub')).toBeNull()
    expect(screen.getByText(/your access continues until/i)).toBeTruthy()
    expect(screen.queryByTestId('btn-cancel-subscription')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Cross-check — once tier is free, no billing/cancel/resubscribe nag', () => {
  it('renders nothing once subscription_tier flips to "free" (server-side sweep already applied)', () => {
    mockTier = 'free'
    const { container } = render(React.createElement(BillingSection))
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('btn-cancel-subscription')).toBeNull()
    expect(screen.queryByText(/subscribe|resubscribe|come back/i)).toBeNull()
  })
})
