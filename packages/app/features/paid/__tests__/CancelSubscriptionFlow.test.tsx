// @vitest-environment happy-dom
/**
 * CancelSubscriptionFlow.test.tsx — the locked-Dialog ≤3-step cancel state
 * machine (confirm -> cancelling -> cancelled | native-action | error).
 *
 * Drives the FULL workflow through each terminal path exactly as a user would
 * experience it: open the dialog, read the confirmation, confirm, and land on
 * whichever end-state the Edge Function response calls for. No dark-pattern
 * retention/discount/reason-field content is ever present, and every failure
 * mode collapses to the same calm inline message with a single Retry.
 *
 * Contract pinned for the green-phase implementer (renaming any of these only
 * requires updating this file's imports/mocks):
 *
 *   `packages/app/features/paid/CancelSubscriptionFlow.tsx` exports
 *   `CancelSubscriptionFlow` with props:
 *     { open: boolean; onOpenChange: (open: boolean) => void;
 *       provider: 'stripe' | 'apple_iap' | 'play_iap'; subscriptionId: string;
 *       currentPeriodEnd: string; onCancelled: () => void }
 *
 *   Internal state machine: 'confirm' -> 'cancelling' -> 'cancelled' |
 *   'native-action' | 'error'.
 *
 *   Collaborators mocked at the module boundary (independently covered
 *   elsewhere): `app/utils/billing/subscriptionApi`'s `cancelSubscription`,
 *   `react-native`'s `Linking` (the deferred cross-platform idiom from
 *   `ModerationReceiptDialog.tsx`). `../nativeStoreLinks`'s
 *   `resolveNativeStoreLink` is NOT mocked — it is a pure function
 *   independently covered in `nativeStoreLinks.test.ts`, and this file
 *   verifies the dialog wires its real output correctly.
 *
 * Red-phase: `packages/app/features/paid/CancelSubscriptionFlow.tsx` does not
 * exist yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── Deferred-promise helper for driving the in-flight "cancelling" state ───
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// ─── react-native Linking spy (the deferred cross-platform idiom target) ───
const openURLMock = vi.fn().mockResolvedValue(undefined)
vi.mock('react-native', () => ({
  Linking: { openURL: openURLMock },
}))

// ─── app/utils/billing/subscriptionApi — independently covered elsewhere ───
const cancelSubscriptionMock = vi.fn()
vi.mock('app/utils/billing/subscriptionApi', () => ({
  cancelSubscription: (args: unknown) => cancelSubscriptionMock(args),
}))

// ─── @my/ui mock — locked-Dialog shape + a11y prop capture ─────────────────
let reduceMotionValue = false

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-live']) out['aria-live'] = props['aria-live']
    if (props.role) out.role = props.role
    if (props.color) out['data-color'] = props.color
    return out
  }

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = () => ReactModule.createElement('div', { 'data-dialog-overlay': 'true' })
  const DialogContent = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-content': 'true' }, children)
  const DialogTitle = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)
  const DialogDescription = ({ children }: any) =>
    ReactModule.createElement('p', { 'data-dialog-desc': 'true' }, children)

  const DialogComponent = ({ children, open }: any) =>
    ReactModule.createElement(
      'div',
      { 'data-dialog': 'true', 'data-open': String(open), role: open ? 'dialog' : undefined },
      open ? children : null
    )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
  })

  return {
    Text: ({ children, ...rest }: any) =>
      ReactModule.createElement('span', mapA11y(rest), children),
    XStack: ({ children, ...rest }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(rest) }, children),
    YStack: ({ children, ...rest }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(rest) }, children),
    Dialog: DialogComponent,
    ExpandingLineButton: ({ children, onPress, disabled, accessibilityLabel, size }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: disabled ? undefined : onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
          'data-size': size ?? 'default',
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => reduceMotionValue,
  }
})

// ─── Import under test — fails until CancelSubscriptionFlow.tsx exists ─────
import { CancelSubscriptionFlow } from '../CancelSubscriptionFlow'

const PERIOD_END = '2026-08-14T00:00:00.000Z'
const MONTHS =
  /January|February|March|April|May|June|July|August|September|October|November|December/

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    provider: 'stripe' as const,
    subscriptionId: 'sub_test_123',
    currentPeriodEnd: PERIOD_END,
    onCancelled: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  cancelSubscriptionMock.mockReset()
  openURLMock.mockReset()
  openURLMock.mockResolvedValue(undefined)
  reduceMotionValue = false
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 of 3 — confirmation
// ─────────────────────────────────────────────────────────────────────────────

describe('Confirmation step — plain-language summary, no dark patterns', () => {
  it('renders exactly: "Your subscription will end on [date]. Cosmetics remain available until then. Streak progression continues unchanged."', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(
      screen.getByText(
        'Your subscription will end on August 14, 2026. Cosmetics remain available until then. Streak progression continues unchanged.'
      )
    ).toBeTruthy()
  })

  it('renders a "Confirm cancel" affordance', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.getByTestId('btn-confirm-cancel')).toBeTruthy()
  })

  it('renders a "Keep subscription" affordance', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.getByTestId('btn-keep-subscription')).toBeTruthy()
  })

  it('never shows a retention questionnaire ("Why are you canceling?")', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.queryByText(/why are you (canceling|cancelling)/i)).toBeNull()
  })

  it('never shows a discount/retention offer ("50% off" / "stay")', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.queryByText(/50% off/i)).toBeNull()
    expect(screen.queryByText(/stay for/i)).toBeNull()
  })

  it('never renders a free-text reason field', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('never shows an "are you sure? are you really sure?" second confirmation loop', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.queryByText(/are you (really )?sure/i)).toBeNull()
  })

  it('"Keep subscription" dismisses the dialog WITHOUT calling cancelSubscription', () => {
    const onOpenChange = vi.fn()
    render(React.createElement(CancelSubscriptionFlow, baseProps({ onOpenChange })))
    fireEvent.click(screen.getByTestId('btn-keep-subscription'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(cancelSubscriptionMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 of 3 — Confirm cancel calls the Edge Function
// ─────────────────────────────────────────────────────────────────────────────

describe('Confirm cancel — calls the cancel Edge Function with the receipt-row pair', () => {
  it('calls cancelSubscription with { provider, subscription_id } from props', async () => {
    const { promise } = deferred<any>()
    cancelSubscriptionMock.mockReturnValue(promise)

    render(
      React.createElement(
        CancelSubscriptionFlow,
        baseProps({ provider: 'stripe', subscriptionId: 'sub_abc999' })
      )
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    expect(cancelSubscriptionMock).toHaveBeenCalledWith({
      provider: 'stripe',
      subscription_id: 'sub_abc999',
    })
  })

  it('disables the Confirm cancel button while the request is in flight', async () => {
    const { promise } = deferred<any>()
    cancelSubscriptionMock.mockReturnValue(promise)

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-confirm-cancel').hasAttribute('disabled')).toBe(true)
    })
  })

  it('a double-tap during the in-flight window fires only ONE cancelSubscription call', async () => {
    const { promise } = deferred<any>()
    cancelSubscriptionMock.mockReturnValue(promise)

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    const button = screen.getByTestId('btn-confirm-cancel')
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    expect(cancelSubscriptionMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 of 3 — Stripe path (requires_native_action: false)
// ─────────────────────────────────────────────────────────────────────────────

describe('Stripe success (requires_native_action: false) — Step 3 of 3 done', () => {
  it('shows "Cancelled. Thanks for being here." on success', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByText('Cancelled. Thanks for being here.')).toBeTruthy()
    })
  })

  it('shows a single "Done" affordance on the cancelled screen', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-done')).toBeTruthy()
    })
  })

  it('calls onCancelled() exactly once on success (drives the receipt-query invalidation)', async () => {
    const onCancelled = vi.fn()
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ onCancelled })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(onCancelled).toHaveBeenCalledTimes(1)
    })
  })

  it('pressing Done dismisses the dialog', async () => {
    const onOpenChange = vi.fn()
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ onOpenChange })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-done')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-done'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Apple/Play path (requires_native_action: true) — auto-appearing native leg
// ─────────────────────────────────────────────────────────────────────────────

describe('Apple/Play success (requires_native_action: true) — native-action leg auto-appears', () => {
  it('shows "Cancellation requires confirming via App Store." automatically for apple_iap (no extra tap)', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByText('Cancellation requires confirming via App Store.')).toBeTruthy()
    })
  })

  it('shows "Cancellation requires confirming via Play Store." automatically for play_iap', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'play_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByText('Cancellation requires confirming via Play Store.')).toBeTruthy()
    })
  })

  it('renders an "Open App Store" affordance for apple_iap', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-open-app-store')).toBeTruthy()
    })
  })

  it('renders an "Open Play Store" affordance for play_iap', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'play_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-open-play-store')).toBeTruthy()
    })
  })

  it('tapping "Open App Store" calls Linking.openURL with the apps.apple.com subscriptions URL', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-open-app-store')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-open-app-store'))

    await waitFor(() => {
      expect(openURLMock).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions')
    })
  })

  it('tapping "Open Play Store" calls Linking.openURL with the play.google.com subscriptions URL', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'play_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-open-play-store')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-open-play-store'))

    await waitFor(() => {
      expect(openURLMock).toHaveBeenCalledWith(
        'https://play.google.com/store/account/subscriptions'
      )
    })
  })

  it('shows the calm fallback line immediately (not only after a failed open)', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(
        screen.getByText('If nothing opened, manage your subscription in the App Store settings.')
      ).toBeTruthy()
    })
  })

  it('shows the Play Store variant of the fallback line for play_iap', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'play_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(
        screen.getByText('If nothing opened, manage your subscription in the Play Store settings.')
      ).toBeTruthy()
    })
  })

  it('the Open [Store] button remains re-tappable and re-fires openURL after a swallowed rejection', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })
    openURLMock.mockRejectedValueOnce(new Error('no handler for scheme'))

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-open-app-store')).toBeTruthy())

    const button = screen.getByTestId('btn-open-app-store')
    fireEvent.click(button)
    await waitFor(() => expect(openURLMock).toHaveBeenCalledTimes(1))

    // The screen must not dead-end: the button stays present/enabled and a
    // second tap fires again.
    expect(screen.getByTestId('btn-open-app-store').hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(openURLMock).toHaveBeenCalledTimes(2))
  })

  it('does NOT require an extra reveal tap — the native-action screen is already showing right after Confirm cancel resolves, with no intermediate step', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    // No further tap between Confirm cancel and the native-action screen appearing.
    await waitFor(() => {
      expect(screen.getByTestId('btn-open-app-store')).toBeTruthy()
    })
    expect(screen.queryByText(/reveal|continue|next step/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — calm, single Retry, never a support loop
// ─────────────────────────────────────────────────────────────────────────────

describe('Error handling — calm inline message + single Retry, no dark patterns', () => {
  it('shows a calm inline error message on failure', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
  })

  it('shows a single Retry affordance on failure', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-retry')).toBeTruthy()
    })
  })

  it('never mentions calling/contacting support', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    expect(screen.queryByText(/call support|contact support|please call/i)).toBeNull()
  })

  it('a generic 404 subscription_not_found renders the SAME message as a 500 — never a scarier or more specific one', async () => {
    cancelSubscriptionMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      code: 'internal',
    })
    const { unmount } = render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    const fiveHundredText = screen.getByRole('status').textContent
    unmount()

    cancelSubscriptionMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      code: 'subscription_not_found',
    })
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    const notFoundText = screen.getByRole('status').textContent

    expect(notFoundText).toBe(fiveHundredText)
    expect(notFoundText?.toLowerCase()).not.toMatch(/not found|no longer exists|doesn.t belong/)
  })

  it('the error indicator never uses a $red* theme token (warm $color* tokens only)', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 502, code: 'provider_fault' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    const status = screen.getByRole('status')
    expect(status.getAttribute('data-color') ?? '').not.toMatch(/\$red/)
  })

  it('"Keep subscription" / dismiss remains available while in the error state', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    expect(screen.getByTestId('btn-keep-subscription')).toBeTruthy()
  })

  it('pressing Retry re-fires cancelSubscription with the same pair', async () => {
    cancelSubscriptionMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' })

    render(
      React.createElement(
        CancelSubscriptionFlow,
        baseProps({ provider: 'stripe', subscriptionId: 'sub_retry_1' })
      )
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    cancelSubscriptionMock.mockResolvedValueOnce({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })
    fireEvent.click(screen.getByTestId('btn-retry'))

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledTimes(2)
    })
    expect(cancelSubscriptionMock).toHaveBeenLastCalledWith({
      provider: 'stripe',
      subscription_id: 'sub_retry_1',
    })
  })

  it('Retry converging to success eventually shows the cancelled/native-action screen', async () => {
    cancelSubscriptionMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    cancelSubscriptionMock.mockResolvedValueOnce({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })
    fireEvent.click(screen.getByTestId('btn-retry'))

    await waitFor(() => {
      expect(screen.getByText('Cancelled. Thanks for being here.')).toBeTruthy()
    })
  })

  it('a user dismiss (Keep subscription) is never treated as an error — no error UI shown', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-keep-subscription'))
    expect(screen.queryByTestId('btn-retry')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dialog lifecycle — reset on reopen, mid-flight Keep lock, native Done,
// provider/flag mismatch fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('Dialog lifecycle — clean reopen + no dead-ends', () => {
  it('reopening after an error resets to the confirm screen (no stale error + Retry)', async () => {
    cancelSubscriptionMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })
    const props = baseProps()
    const { rerender } = render(React.createElement(CancelSubscriptionFlow, props))

    // Drive into the error terminal.
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    // Dismiss (close) then reopen.
    rerender(React.createElement(CancelSubscriptionFlow, { ...props, open: false }))
    rerender(React.createElement(CancelSubscriptionFlow, { ...props, open: true }))

    // Fresh confirmation screen — a stale error + one-tap Retry would re-fire an
    // un-reconfirmed cancel.
    expect(screen.getByTestId('btn-confirm-cancel')).toBeTruthy()
    expect(screen.queryByTestId('btn-retry')).toBeNull()
  })

  it('reopening after the native-action screen resets to the confirm screen', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })
    const props = baseProps({ provider: 'apple_iap' })
    const { rerender } = render(React.createElement(CancelSubscriptionFlow, props))

    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-open-app-store')).toBeTruthy())

    rerender(React.createElement(CancelSubscriptionFlow, { ...props, open: false }))
    rerender(React.createElement(CancelSubscriptionFlow, { ...props, open: true }))

    expect(screen.getByTestId('btn-confirm-cancel')).toBeTruthy()
    expect(screen.queryByTestId('btn-open-app-store')).toBeNull()
  })

  it('disables "Keep subscription" while the cancel request is in flight', async () => {
    const { promise } = deferred<any>()
    cancelSubscriptionMock.mockReturnValue(promise)

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-keep-subscription').hasAttribute('disabled')).toBe(true)
    })
  })

  it('the native-action screen exposes an explicit Done affordance that dismisses the dialog', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })
    const onOpenChange = vi.fn()

    render(
      React.createElement(
        CancelSubscriptionFlow,
        baseProps({ provider: 'apple_iap', onOpenChange })
      )
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))
    await waitFor(() => expect(screen.getByTestId('btn-done')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-done'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('fires onCancelled() exactly once on the native-action path (drives the receipt-query invalidation)', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })
    const onCancelled = vi.fn()

    render(
      React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap', onCancelled }))
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1))
  })

  it('a stripe + requires_native_action:true mismatch falls back to the Done screen, never a blank dialog', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })
    const onCancelled = vi.fn()

    // Stripe resolves no native store link — the native-action UI would be a
    // title with an empty button row. The flow must land on Done instead.
    render(
      React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'stripe', onCancelled }))
    )
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => expect(screen.getByTestId('btn-done')).toBeTruthy())
    expect(screen.getByText('Cancelled. Thanks for being here.')).toBeTruthy()
    expect(screen.queryByTestId('btn-open-app-store')).toBeNull()
    expect(screen.queryByTestId('btn-open-play-store')).toBeNull()
    expect(onCancelled).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility
// ─────────────────────────────────────────────────────────────────────────────

describe('Accessibility — announced state transitions + labeled controls', () => {
  it('the confirm step exposes an accessible label on Confirm cancel', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.getByTestId('btn-confirm-cancel').getAttribute('aria-label')).toBeTruthy()
  })

  it('the confirm step exposes an accessible label on Keep subscription', () => {
    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    expect(screen.getByTestId('btn-keep-subscription').getAttribute('aria-label')).toBeTruthy()
  })

  it('the cancelled screen announces via a role="status" region', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: false,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/cancelled/i)
    })
  })

  it('the native-action screen announces via a role="status" region', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      ok: true,
      current_period_end: '2026-08-14T00:00:00Z',
      requires_native_action: true,
    })

    render(React.createElement(CancelSubscriptionFlow, baseProps({ provider: 'apple_iap' })))
    fireEvent.click(screen.getByTestId('btn-confirm-cancel'))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy()
    })
  })
})
