// @vitest-environment happy-dom
/**
 * PaidTierPurchaseSurface.test.tsx — the platform-agnostic purchase surface.
 *
 * Collaborator seams mocked here (renaming only requires updating this file's
 * `vi.mock(...)` targets):
 *
 *   - `./purchaseFlow` exports `attemptPurchase(userId: string):
 *     Promise<{ status: 'success'; outcome: { provider: Provider;
 *     raw_receipt: string } } | { status: 'cancelled' }>` — the single
 *     platform-dispatch seam (web Stripe redirect-and-return / native IAP
 *     sheet), mirroring how `ReminderSettings.tsx` reuses
 *     `app/utils/pushTokens` as an already-covered collaborator rather than
 *     re-testing native SDK plumbing here. `.native.tsx`/`.web.tsx`
 *     splitting of the REAL dispatch is an implementation detail behind
 *     this same import specifier.
 *   - `app/utils/billing/subscriptionApi` exports `validateReceipt(...)`
 *     (already independently covered in subscriptionApi.test.ts) — mocked
 *     here so this file only asserts the SURFACE's reaction to its result.
 *   - `app/state/store` exports `applySubscriptionTierFromServer(tier)` —
 *     the setter that reflects the server's authoritative tier onto
 *     `store$.profile.subscription_tier` (independently covered in
 *     state/__tests__/subscriptionTier.e2e.test.ts against the REAL store;
 *     mocked here as a spy).
 *   - The calm warm-dot error indicator renders with
 *     `data-testid="billing-error-dot"` and forwards its `backgroundColor`
 *     prop for inspection — asserting it is a `$color*` theme token, never
 *     a `$red*` literal.
 *
 * Red-phase: `packages/app/features/paid/PaidTierPurchaseSurface.tsx` does
 * not exist yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── Deferred-promise helper for driving intermediate "purchasing" state ────
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ─── Mutable mock state ─────────────────────────────────────────────────────
let mockTier: 'free' | 'paid_monthly' | 'paid_yearly' = 'free'
let mockUserId: string | null = 'user-uuid-abc123'
const mockRouterPush = vi.fn()
const mockToastShow = vi.fn()
const mockApplyTier = vi.fn()
const attemptPurchaseMock = vi.fn()
const validateReceiptMock = vi.fn()

// ─── @legendapp/state/react — use$() reads observable.get() synchronously ──
vi.mock('@legendapp/state/react', () => ({
  use$: (obs: any) => {
    if (obs && typeof obs.get === 'function') return obs.get()
    return obs
  },
}))

// ─── solito/navigation ───────────────────────────────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ─── app/state/store — nested-getter pattern (mirrors ThemePicker.unlock.test.tsx) ──
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
  applySubscriptionTierFromServer: (...args: unknown[]) => mockApplyTier(...args),
}))

// ─── ./purchaseFlow — the platform purchase-kickoff seam ────────────────────
vi.mock('../purchaseFlow', () => ({
  attemptPurchase: (userId: string) => attemptPurchaseMock(userId),
}))

// ─── app/utils/billing/subscriptionApi — independently covered elsewhere ───
vi.mock('app/utils/billing/subscriptionApi', () => ({
  validateReceipt: (args: unknown) => validateReceiptMock(args),
}))

// ─── ../BillingDisclosure — independently covered in its own test file ─────
vi.mock('../BillingDisclosure', () => ({
  BillingDisclosure: () => React.createElement('div', { 'data-testid': 'billing-disclosure-stub' }),
}))

// ─── @my/ui mock — passthroughs + prop capture for a11y / color inspection ──
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props.testID) out['data-testid'] = props.testID
    if (props['aria-live']) out['aria-live'] = props['aria-live']
    if (props.role) out.role = props.role
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props.backgroundColor) out['data-bg'] = props.backgroundColor
    return out
  }

  const Text = ({ children, ...rest }: any) =>
    ReactModule.createElement('span', mapA11y(rest), children)
  const XStack = ({ children, ...rest }: any) =>
    ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(rest) }, children)
  const YStack = ({ children, ...rest }: any) =>
    ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(rest) }, children)
  const View = ({ children, ...rest }: any) =>
    ReactModule.createElement('div', mapA11y(rest), children)

  const ExpandingLineButton = ({
    children,
    onPress,
    disabled,
    size,
    accessibilityLabel,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'button',
      {
        onClick: disabled ? undefined : onPress,
        disabled: !!disabled,
        'aria-disabled': disabled ? 'true' : 'false',
        'data-size': size ?? 'default',
        'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
        ...mapA11y(rest),
      },
      children
    )

  return {
    Text,
    XStack,
    YStack,
    View,
    ExpandingLineButton,
    isWeb: true,
    useToastController: () => ({ show: mockToastShow }),
  }
})

// Import under test — fails until PaidTierPurchaseSurface.tsx exists.
import { PaidTierPurchaseSurface } from '../PaidTierPurchaseSurface'

beforeEach(() => {
  mockTier = 'free'
  mockUserId = 'user-uuid-abc123'
  mockRouterPush.mockReset()
  mockToastShow.mockReset()
  mockApplyTier.mockReset()
  attemptPurchaseMock.mockReset()
  validateReceiptMock.mockReset()
  // Reset the address bar so a return-leg session id from one test never
  // bleeds into the next (the surface auto-detects `?session_id=cs_...`).
  window.history.pushState({}, '', '/paid')
})

afterEach(() => {
  cleanup()
})

// ==========================================================================
// Idle-state layout + copy
// ==========================================================================

describe('Idle state — layout, value proposition, pricing', () => {
  it('renders the BillingDisclosure surface', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByTestId('billing-disclosure-stub')).toBeTruthy()
  })

  it('renders the decided monthly price exactly as "$4.99 / month"', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByText('$4.99 / month')).toBeTruthy()
  })

  it('renders the decided yearly price exactly as "$39.99 / year"', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByText('$39.99 / year')).toBeTruthy()
  })

  it('renders the plain savings line exactly as "33% saving on twelve monthly payments"', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByText('33% saving on twelve monthly payments')).toBeTruthy()
  })

  it('never renders dark-pattern urgency chrome (no "limited time", no countdown/timer, no "hurry")', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.queryByText(/limited time/i)).toBeNull()
    expect(screen.queryByText(/hurry/i)).toBeNull()
    expect(screen.queryByText(/ends? (soon|in)/i)).toBeNull()
    expect(screen.queryByText(/countdown/i)).toBeNull()
  })

  it('never renders a "BEST VALUE" or loud-chrome badge on the yearly plan', () => {
    render(<PaidTierPurchaseSurface />)
    expect(screen.queryByText(/best value/i)).toBeNull()
  })

  it('renders value-proposition copy covering instant cosmetic unlocks, AI quotas (growth slot), and indie-product support', () => {
    render(<PaidTierPurchaseSurface />)
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/unlock/i)
    expect(body).toMatch(/AI/)
    expect(body).toMatch(/indie/i)
  })

  it('renders a Subscribe affordance sized as the CTA', () => {
    render(<PaidTierPurchaseSurface />)
    const button = screen.getByRole('button', { name: /subscribe/i })
    expect(button.getAttribute('data-size')).toBe('cta')
  })
})

// ==========================================================================
// Already-subscribed state
// ==========================================================================

describe('Already-subscribed state — avoid double purchase', () => {
  it('renders "You\'re already subscribed." instead of the purchase flow when tier is paid_monthly', () => {
    mockTier = 'paid_monthly'
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByText(/you.re already subscribed/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
  })

  it('renders the already-subscribed affordance for paid_yearly too', () => {
    mockTier = 'paid_yearly'
    render(<PaidTierPurchaseSurface />)
    expect(screen.getByText(/you.re already subscribed/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
  })

  it('renders a "View billing settings" link that routes to Settings', () => {
    mockTier = 'paid_monthly'
    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByText(/view billing settings/i))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })

  it('does NOT render the pricing lines in the already-subscribed state (no upgrade pressure)', () => {
    mockTier = 'paid_monthly'
    render(<PaidTierPurchaseSurface />)
    expect(screen.queryByText('$4.99 / month')).toBeNull()
    expect(screen.queryByText('$39.99 / year')).toBeNull()
  })
})

// ==========================================================================
// Purchase flow — idle -> purchasing -> purchased
// ==========================================================================

describe('Purchase flow — Subscribe kicks off the platform billing flow', () => {
  it('calls attemptPurchase with the current session userId when Subscribe is tapped', async () => {
    const { promise } = deferred<{ status: 'cancelled' }>()
    attemptPurchaseMock.mockReturnValue(promise)

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(attemptPurchaseMock).toHaveBeenCalledWith('user-uuid-abc123'))
  })

  it('disables the Subscribe affordance while purchasing is in flight', async () => {
    const { promise } = deferred<{ status: 'cancelled' }>()
    attemptPurchaseMock.mockReturnValue(promise)

    render(<PaidTierPurchaseSurface />)
    const button = screen.getByRole('button', { name: /subscribe/i })
    fireEvent.click(button)

    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'))
  })

  it('on a successful purchase outcome, POSTs the receipt to validateReceipt with the exact provider/raw_receipt', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockReturnValue(new Promise(() => {})) // never resolves — inspect the call args only

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() =>
      expect(validateReceiptMock).toHaveBeenCalledWith({
        provider: 'stripe',
        raw_receipt: 'cs_test_abc123',
      })
    )
  })

  it('on validateReceipt success, applies the returned tier to the client store', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'apple_iap', raw_receipt: 'apple-receipt-blob' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_monthly',
      current_period_end: '2026-08-14T00:00:00Z',
    })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(mockApplyTier).toHaveBeenCalledWith('paid_monthly'))
  })

  it('on validateReceipt success, renders the purchased confirmation copy + a Done affordance', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_yearly',
      current_period_end: '2027-07-14T00:00:00Z',
    })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByText("Thanks. Everything's unlocked.")).toBeTruthy())
    expect(screen.getByRole('button', { name: /done/i })).toBeTruthy()
  })

  it('clicking Done after purchase routes back to the theme picker (Settings)', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_monthly',
      current_period_end: '2026-08-14T00:00:00Z',
    })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /done/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })

  it('the purchased confirmation region is announced via aria-live', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_monthly',
      current_period_end: '2026-08-14T00:00:00Z',
    })

    const { container } = render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByText("Thanks. Everything's unlocked.")).toBeTruthy())
    expect(container.querySelector('[aria-live]')).toBeTruthy()
  })
})

// ==========================================================================
// Cancel + error handling — calm, no dark patterns
// ==========================================================================

describe('User-cancel — silent return to idle, no toast', () => {
  it('a cancelled purchase sheet returns to idle without any toast', async () => {
    attemptPurchaseMock.mockResolvedValue({ status: 'cancelled' })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeTruthy())
    expect(mockToastShow).not.toHaveBeenCalled()
  })

  it('the value proposition (pricing) is still visible after a cancel', async () => {
    attemptPurchaseMock.mockResolvedValue({ status: 'cancelled' })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByText('$4.99 / month')).toBeTruthy())
  })

  it('a cancel never calls validateReceipt', async () => {
    attemptPurchaseMock.mockResolvedValue({ status: 'cancelled' })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeTruthy())
    expect(validateReceiptMock).not.toHaveBeenCalled()
  })
})

describe('Validation-failure error state — calm warm-dot toast + Retry', () => {
  it('shows a toast with a single Retry affordance on a validation failure, then returns to idle', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({ ok: false, code: 'internal', status: 500 })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    // Idle value prop still visible — no scolding, no dead-end.
    expect(screen.getByText('$4.99 / month')).toBeTruthy()
  })

  it('the warm error indicator uses a $color* theme token, never a fixed $red*', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({ ok: false, code: 'internal', status: 500 })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByTestId('billing-error-dot')).toBeTruthy())
    const dot = screen.getByTestId('billing-error-dot')
    const bg = dot.getAttribute('data-bg') ?? ''
    expect(bg).toMatch(/^\$color(8|9|10|11|12)$/)
    expect(bg).not.toMatch(/^\$red/)
  })

  it('clicking Retry re-attempts the purchase', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({ ok: false, code: 'internal', status: 500 })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(attemptPurchaseMock).toHaveBeenCalledTimes(2))
  })

  it('a 409 receipt_ownership_conflict surfaces through the SAME generic calm toast — never a scarier/more specific message', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: false,
      code: 'receipt_ownership_conflict',
      status: 409,
    })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledTimes(1))
    const [, options] = mockToastShow.mock.calls[0] as [string, { message?: string }]
    const renderedMessage = `${mockToastShow.mock.calls[0]?.[0] ?? ''} ${options?.message ?? ''}`
    // No account/owner-specific leak — the generic no-oracle message only.
    expect(renderedMessage).not.toMatch(/owner|another account|already claimed by/i)
  })

  it('never applies a subscription tier to the store on a validation failure', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockResolvedValue({ ok: false, code: 'bad_request', status: 400 })

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledTimes(1))
    expect(mockApplyTier).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// Unexpected-throw resilience — never stuck in the disabled purchasing state
// ==========================================================================

describe('Unexpected throw — calm generic toast + Retry, never a stuck disabled state', () => {
  it('a throw from the purchase kickoff surfaces the generic toast and drops to the error state', async () => {
    attemptPurchaseMock.mockRejectedValue(new Error('malformed payment link'))

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    // Retry (not a permanently-disabled Subscribe) engages, and the calm
    // generic toast fired exactly once.
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy())
    expect(mockToastShow).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull()
    // No tier applied on a throw.
    expect(mockApplyTier).not.toHaveBeenCalled()
  })

  it('a throw from receipt validation is handled the same calm way', async () => {
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_abc123' },
    })
    validateReceiptMock.mockRejectedValue(new Error('boom'))

    render(<PaidTierPurchaseSurface />)
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy())
    expect(mockToastShow).toHaveBeenCalledTimes(1)
    expect(mockApplyTier).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// Stripe success return leg — auto-detect ?session_id=cs_... on mount
// ==========================================================================

describe('Stripe return leg — auto-validates a cs_... session id on mount without a second Subscribe tap', () => {
  it('drives validate -> purchased automatically when the URL carries a cs_... session id', async () => {
    window.history.pushState({}, '', '/paid?session_id=cs_test_return_abc')
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_return_abc' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_monthly',
      current_period_end: '2026-08-14T00:00:00Z',
    })

    render(<PaidTierPurchaseSurface />)

    // No user interaction — the surface reacts to the return-leg URL itself.
    await waitFor(() => expect(mockApplyTier).toHaveBeenCalledWith('paid_monthly'))
    await waitFor(() => expect(screen.getByText("Thanks. Everything's unlocked.")).toBeTruthy())
  })

  it('does not auto-validate when there is no session id in the URL', async () => {
    render(<PaidTierPurchaseSurface />)
    // Idle Subscribe affordance is present and nothing fired on its own.
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeTruthy()
    await waitFor(() => expect(attemptPurchaseMock).not.toHaveBeenCalled())
  })

  it('already-subscribed takes precedence over the return-leg URL — no auto-validation', async () => {
    window.history.pushState({}, '', '/paid?session_id=cs_test_return_abc')
    mockTier = 'paid_monthly'

    render(<PaidTierPurchaseSurface />)

    expect(screen.getByText(/you.re already subscribed/i)).toBeTruthy()
    await waitFor(() => expect(attemptPurchaseMock).not.toHaveBeenCalled())
    expect(validateReceiptMock).not.toHaveBeenCalled()
  })

  it('auto-validation fires at most once even across re-renders', async () => {
    window.history.pushState({}, '', '/paid?session_id=cs_test_return_abc')
    attemptPurchaseMock.mockResolvedValue({
      status: 'success',
      outcome: { provider: 'stripe', raw_receipt: 'cs_test_return_abc' },
    })
    validateReceiptMock.mockResolvedValue({
      ok: true,
      subscription_tier: 'paid_yearly',
      current_period_end: '2027-08-14T00:00:00Z',
    })

    const { rerender } = render(<PaidTierPurchaseSurface />)
    await waitFor(() => expect(attemptPurchaseMock).toHaveBeenCalledTimes(1))
    rerender(<PaidTierPurchaseSurface />)
    // Still exactly one kickoff — the ref guard prevents a double-fire.
    await waitFor(() => expect(attemptPurchaseMock).toHaveBeenCalledTimes(1))
  })
})
