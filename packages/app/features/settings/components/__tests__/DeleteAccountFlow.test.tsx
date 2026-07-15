// @vitest-environment happy-dom
/**
 * DeleteAccountFlow.test.tsx — the locked-Dialog 3-step account-deletion
 * confirmation flow, cloned structurally from `CancelSubscriptionFlow`.
 *
 * Drives the FULL workflow through each terminal path exactly as a user
 * would experience it: open the dialog, read the plain-language warning,
 * type the confirmation email, (optionally) read the active-subscription
 * warning, confirm via the underline-grow CTA, and land on whichever
 * end-state the Edge Function response calls for.
 *
 * Contract pinned for the green-phase implementer (renaming any of these
 * only requires updating this file's imports/mocks):
 *
 *   `packages/app/features/settings/components/DeleteAccountFlow.tsx`
 *   exports `DeleteAccountFlow` with props:
 *     { open: boolean; onOpenChange: (open: boolean) => void }
 *   No other props — userId/email/receipt are all read internally from
 *   `store$.session` / `useSubscriptionReceipt`, exactly like
 *   `CancelSubscriptionFlow` reads its own collaborators.
 *
 *   Internal state machine:
 *     'warning' -> 'email' -> ('subscription-warning' | skip) -> 'confirm'
 *       -> 'deleting' -> 'deleted' | 'native-action' | 'error'
 *
 *   Test ids (this file's asserted contract — `ExpandingLineButton` testids
 *   are derived from the visible label, lowercased/dashed, mirroring
 *   `CancelSubscriptionFlow.test.tsx`'s `@my/ui` mock):
 *     - warning step body:      `delete-account-warning`
 *     - email step body:        `delete-account-email-step`
 *     - email input:            `delete-email-input`
 *     - subscription-warning:   `delete-account-subscription-warning`
 *     - confirm step body:      `delete-account-confirm-step`
 *     - error region:           `delete-account-error` (role="status")
 *     - goodbye/terminal region: `delete-account-goodbye` (role="status")
 *     - native-action region:   `delete-account-native-action`
 *     - buttons (label-derived): `btn-continue`, `btn-keep-my-account`,
 *       `btn-delete-my-account`, `btn-retry`, `btn-return-home`,
 *       `btn-open-app-store`, `btn-open-play-store`
 *
 *   Collaborators mocked at the module boundary (independently covered
 *   elsewhere): `app/utils/billing/subscriptionApi`'s `deleteMyAccount`,
 *   `app/state/subscriptionReceipt`'s `useSubscriptionReceipt`,
 *   `app/state/accountCleanup`'s `runPostDeletionCleanup`, `solito/navigation`'s
 *   `useRouter`, `app/state/store` (getter-observable pattern — see
 *   `HomeScreen.collective-gate.test.tsx`), and `app/state/syncConfig` (same
 *   getter-observable pattern, for the persisted `deviceState$.pendingAccountCleanup`
 *   boot-resume flag). `../nativeStoreLinks` (well, its sibling in
 *   `features/paid/`) is NOT mocked for the native-action leg — it is a pure
 *   function independently covered elsewhere, and this file verifies the
 *   real deep-link output is wired.
 *
 * Red-phase: `packages/app/features/settings/components/DeleteAccountFlow.tsx`
 * does not exist yet — this whole file fails at the top-level import with a
 * module-resolution error until it is created.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── Deferred-promise helper for driving in-flight states ──────────────────
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ─── react-native Linking spy (the deferred cross-platform idiom target,
// reused verbatim from CancelSubscriptionFlow's native-action leg) ─────────
const openURLMock = vi.fn().mockResolvedValue(undefined)
vi.mock('react-native', () => ({
  Linking: { openURL: openURLMock },
}))

// ─── app/utils/billing/subscriptionApi — the deleteMyAccount wrapper ───────
const deleteMyAccountMock = vi.fn()
vi.mock('app/utils/billing/subscriptionApi', () => ({
  deleteMyAccount: () => deleteMyAccountMock(),
}))

// ─── app/state/subscriptionReceipt — the cross-domain TanStack hook ───────
const useSubscriptionReceiptMock = vi.fn((_userId: string | null) => undefined as unknown)
vi.mock('app/state/subscriptionReceipt', () => ({
  useSubscriptionReceipt: (userId: string | null) => useSubscriptionReceiptMock(userId),
}))

// ─── app/state/accountCleanup — the post-deletion local cleanup seam ──────
const runPostDeletionCleanupMock = vi.fn()
vi.mock('app/state/accountCleanup', () => ({
  runPostDeletionCleanup: () => runPostDeletionCleanupMock(),
}))

// ─── solito/navigation — route-home on the goodbye screen ─────────────────
const pushSpy = vi.fn()
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
}))

// ─── app/state/store — getter-observable pattern (HomeScreen.collective-gate
// precedent): `use$`/@legendapp/state/react is left UNMOCKED so the real hook
// reacts to `.set()` calls made from the test body. Observables are built via
// `vi.importActual` inside the async factory so they are the SAME module
// instance the real `use$` recognizes.
vi.mock('app/state/store', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const email$ = observable<string | null>('user@example.com')
  const userId$ = observable<string | null>('user-1')
  const isAuthenticated$ = observable(true)
  return {
    store$: {
      session: {
        email: email$,
        userId: userId$,
        isAuthenticated: isAuthenticated$,
      },
    },
  }
})

// ─── app/state/syncConfig — the persisted, device-scoped boot-resume flag ──
// Same getter-observable pattern as the store$ mock above: built via
// vi.importActual so the REAL use$/.set() reactivity works.
vi.mock('app/state/syncConfig', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const pendingAccountCleanup$ = observable(false)
  return {
    deviceState$: {
      pendingAccountCleanup: pendingAccountCleanup$,
    },
  }
})

// ─── @my/ui mock — locked-Dialog shape + label-derived testids (mirrors
// CancelSubscriptionFlow.test.tsx's mock, plus an Input for the email step) ─
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-live']) out['aria-live'] = props['aria-live']
    if (props.role) out.role = props.role
    if (props.testID) out['data-testid'] = props.testID
    return out
  }

  const DialogPortal = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-portal': 'true' }, children)
  const DialogOverlay = () => ReactModule.createElement('div', { 'data-dialog-overlay': 'true' })
  const DialogContent = ({ children }: any) =>
    ReactModule.createElement('div', { 'data-dialog-content': 'true' }, children)
  const DialogTitle = ({ children }: any) =>
    ReactModule.createElement('h2', { 'data-dialog-title': 'true' }, children)

  // `onOpenChange` models Tamagui's implicit dismissal (escape key / overlay
  // tap): a hidden `dialog-backdrop-dismiss` affordance routes `false` through
  // the same handler the real Dialog would call, so tests can assert the
  // component's non-dismissable interception without a real Radix layer.
  const DialogComponent = ({ children, open, onOpenChange }: any) =>
    ReactModule.createElement(
      'div',
      {
        'data-dialog': 'true',
        'data-open': String(open),
        role: open ? 'dialog' : undefined,
        'aria-modal': open ? 'true' : undefined,
      },
      open
        ? [
            ReactModule.createElement('button', {
              key: 'backdrop-dismiss',
              'data-testid': 'dialog-backdrop-dismiss',
              onClick: () => onOpenChange?.(false),
            }),
            ReactModule.createElement(ReactModule.Fragment, { key: 'content' }, children),
          ]
        : null
    )
  Object.assign(DialogComponent, {
    Portal: DialogPortal,
    Overlay: DialogOverlay,
    Content: DialogContent,
    Title: DialogTitle,
  })

  const Input = ({ testID, value, onChangeText }: any) =>
    ReactModule.createElement('input', {
      ...(testID ? { 'data-testid': testID } : {}),
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
    })

  return {
    Text: ({ children, ...rest }: any) =>
      ReactModule.createElement('span', mapA11y(rest), children),
    XStack: ({ children, ...rest }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(rest) }, children),
    YStack: ({ children, ...rest }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(rest) }, children),
    Dialog: DialogComponent,
    Input,
    ExpandingLineButton: ({ children, onPress, disabled, accessibilityLabel, id }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: disabled ? undefined : onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
          id,
          'data-testid': `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),
    useReducedMotion: () => false,
  }
})

// ─── Import under test — fails until DeleteAccountFlow.tsx exists ─────────
import { DeleteAccountFlow } from '../DeleteAccountFlow'
import { store$ } from 'app/state/store'
import { deviceState$ } from 'app/state/syncConfig'

const email$ = store$.session.email
const userId$ = store$.session.userId
const isAuthenticated$ = store$.session.isAuthenticated
const pendingAccountCleanup$ = deviceState$.pendingAccountCleanup

const CORRECT_EMAIL = 'user@example.com'

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  }
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByTestId('delete-email-input'), { target: { value } })
}

/** Drives warning -> email -> (match) -> Continue, landing on either the
 * subscription-warning step or the confirm step depending on the mocked
 * receipt. */
function proceedPastWarningAndEmail() {
  fireEvent.click(screen.getByTestId('btn-continue'))
  typeEmail(CORRECT_EMAIL)
  fireEvent.click(screen.getByTestId('btn-continue'))
}

beforeEach(() => {
  deleteMyAccountMock.mockReset()
  runPostDeletionCleanupMock.mockReset().mockResolvedValue(undefined)
  useSubscriptionReceiptMock.mockReset().mockReturnValue(undefined)
  pushSpy.mockClear()
  openURLMock.mockReset().mockResolvedValue(undefined)
  act(() => {
    email$.set(CORRECT_EMAIL)
    userId$.set('user-1')
    isAuthenticated$.set(true)
    pendingAccountCleanup$.set(false)
  })
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 of 3 — plain-language warning, exact epic copy
// ─────────────────────────────────────────────────────────────────────────────

describe('Step 1 — plain-language warning (verbatim, honest anonymize-vs-delete disclosure)', () => {
  it('renders every clause of the warning copy verbatim', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    const content = screen.getByTestId('delete-account-warning').textContent ?? ''

    expect(content).toContain('Deleting your account will:')
    expect(content).toContain(
      'Permanently delete your journal entries, reminders, themes, and account data.'
    )
    expect(content).toContain('Anonymize')
    expect(content).toContain('your Collective posts and reactions')
    expect(content).toContain(
      'The text of your posts will remain visible to the Collective, but your name will be removed and cannot be linked back to you.'
    )
    expect(content).toContain(
      '(This preserves the conversations other people built with your contributions.)'
    )
    expect(content).toContain('Cancel any active subscription via your billing provider.')
    expect(content).toContain(
      'This cannot be undone. Server-side cleanup will complete within 30 days.'
    )
    expect(content).toContain(
      'If you want a specific Collective post fully erased (text and all), delete it individually first'
    )
    expect(content).toContain("that replaces the text with '[deleted]'")
  })

  it('offers a non-destructive escape ("Keep my account") that dismisses the dialog without calling deleteMyAccount', () => {
    const onOpenChange = vi.fn()
    render(React.createElement(DeleteAccountFlow, baseProps({ onOpenChange })))

    fireEvent.click(screen.getByTestId('btn-keep-my-account'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(deleteMyAccountMock).not.toHaveBeenCalled()
  })

  it('renders a Continue affordance that advances to the email confirmation step', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))

    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('delete-account-email-step')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 of 3 — typed-email confirmation gate
// ─────────────────────────────────────────────────────────────────────────────

describe('Step 2 — typed-email confirmation gates progression', () => {
  it('the Continue affordance stays disabled with an empty input', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(true)
  })

  it('stays disabled for a mismatched email', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))
    typeEmail('someone-else@example.com')

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(true)
  })

  it('enables on an exact-case match', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))
    typeEmail(CORRECT_EMAIL)

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(false)
  })

  it('enables on a case-INsensitive match (email local-part case is user-hostile to enforce)', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))
    typeEmail('USER@EXAMPLE.COM')

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(false)
  })

  it('enables on a whitespace-padded match (trimmed comparison)', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))
    typeEmail(`  ${CORRECT_EMAIL}  `)

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(false)
  })

  it("displays the user's own expected email address (not a secret)", () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('delete-account-email-step').textContent).toContain(CORRECT_EMAIL)
  })

  it('does not block pasted input — a single change event carrying the full email enables Continue', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))
    // Simulates a paste: one change event with the full value, no keystrokes.
    fireEvent.change(screen.getByTestId('delete-email-input'), {
      target: { value: CORRECT_EMAIL },
    })

    expect(screen.getByTestId('btn-continue').hasAttribute('disabled')).toBe(false)
  })

  it('a null session.email while authenticated shows the calm error state rather than allowing progression', () => {
    act(() => email$.set(null))
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('delete-account-error')).toBeTruthy()
    expect(screen.queryByTestId('delete-email-input')).toBeNull()
  })

  it('an EMPTY-STRING session.email (phone-only auth) is treated like null — calm error, no input, no progression', () => {
    act(() => email$.set(''))
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('delete-account-error')).toBeTruthy()
    expect(screen.queryByTestId('delete-email-input')).toBeNull()
  })

  it('a whitespace-only session.email is treated like null — calm error, no progression', () => {
    act(() => email$.set('   '))
    render(React.createElement(DeleteAccountFlow, baseProps()))
    fireEvent.click(screen.getByTestId('btn-continue'))

    expect(screen.getByTestId('delete-account-error')).toBeTruthy()
    expect(screen.queryByTestId('delete-email-input')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Conditional step — active-subscription warning variant
// ─────────────────────────────────────────────────────────────────────────────

describe('Conditional step — active-subscription warning (provider display names)', () => {
  it('inserts the warning for an "active" Stripe receipt, naming "Stripe"', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'stripe',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'sub_123',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.getByTestId('delete-account-subscription-warning').textContent).toBe(
      "You have an active Stripe subscription. Deleting your account will cancel it via Stripe. If your provider requires native confirmation, you'll be directed there after this step."
    )
  })

  it('inserts the warning for a "past_due" receipt (not just "active")', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'stripe',
      status: 'past_due',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'sub_123',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.getByTestId('delete-account-subscription-warning')).toBeTruthy()
  })

  it('names "App Store" for apple_iap (contractual literal, grammatical prose)', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.getByTestId('delete-account-subscription-warning').textContent).toBe(
      "You have an active App Store subscription. Deleting your account will cancel it via App Store. If your provider requires native confirmation, you'll be directed there after this step."
    )
  })

  it('names "Play Store" for play_iap (contractual literal)', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'play_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'gpa.token.1',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.getByTestId('delete-account-subscription-warning').textContent).toBe(
      "You have an active Play Store subscription. Deleting your account will cancel it via Play Store. If your provider requires native confirmation, you'll be directed there after this step."
    )
  })

  it('skips the step entirely for a canceled receipt', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'stripe',
      status: 'canceled',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'sub_123',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.queryByTestId('delete-account-subscription-warning')).toBeNull()
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()
  })

  it('skips the step when there is no receipt at all (null)', () => {
    useSubscriptionReceiptMock.mockReturnValue(null)
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.queryByTestId('delete-account-subscription-warning')).toBeNull()
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()
  })

  it('a still-loading (undefined) receipt shows no warning and does NOT block progression to the confirm step', () => {
    useSubscriptionReceiptMock.mockReturnValue(undefined)
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.queryByTestId('delete-account-subscription-warning')).toBeNull()
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()
  })

  it('the warning step offers Continue (to the final confirm) and Keep my account', () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'stripe',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'sub_123',
    })
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    fireEvent.click(screen.getByTestId('btn-continue'))
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 of 3 — final confirm via ExpandingLineButton
// ─────────────────────────────────────────────────────────────────────────────

describe('Step 3 — final confirm fires deleteMyAccount exactly once (double-fire guard)', () => {
  it('renders an ExpandingLineButton (never a filled primary button) labeled to delete the account', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()

    expect(screen.getByTestId('btn-delete-my-account')).toBeTruthy()
  })

  it('pressing confirm calls deleteMyAccount() with no arguments', async () => {
    const { promise } = deferred<any>()
    deleteMyAccountMock.mockReturnValue(promise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    expect(deleteMyAccountMock).toHaveBeenCalledWith()
  })

  it('a double/triple-tap during the in-flight window fires only ONE deleteMyAccount call', async () => {
    const { promise } = deferred<any>()
    deleteMyAccountMock.mockReturnValue(promise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    const btn = screen.getByTestId('btn-delete-my-account')
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)

    expect(deleteMyAccountMock).toHaveBeenCalledTimes(1)
  })

  it('disables action buttons while the deletion request is in flight', async () => {
    const { promise } = deferred<any>()
    deleteMyAccountMock.mockReturnValue(promise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-delete-my-account').hasAttribute('disabled')).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Success — flag → cleanup seam → goodbye → home
// ─────────────────────────────────────────────────────────────────────────────

describe('Success — flag set before the fire-and-forget cleanup seam, goodbye renders synchronously', () => {
  it('sets deviceState$.pendingAccountCleanup to true on ok, BEFORE the seam resolves', async () => {
    const { promise, resolve } = deferred<{
      ok: true
      deleted_at: string
      requires_native_subscription_action: boolean
    }>()
    deleteMyAccountMock.mockReturnValue(promise)
    const { promise: seamPromise } = deferred<void>()
    runPostDeletionCleanupMock.mockReturnValue(seamPromise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await act(async () => {
      resolve({
        ok: true,
        deleted_at: '2026-07-15T00:00:00Z',
        requires_native_subscription_action: false,
      })
      await promise
    })

    await waitFor(() => expect(pendingAccountCleanup$.get()).toBe(true))
  })

  it('invokes runPostDeletionCleanup() immediately on ok', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const { promise: seamPromise } = deferred<void>()
    runPostDeletionCleanupMock.mockReturnValue(seamPromise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(runPostDeletionCleanupMock).toHaveBeenCalledTimes(1))
  })

  it('renders the goodbye terminal state WITHOUT awaiting the cleanup seam (seam still pending)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const { promise: seamPromise } = deferred<void>()
    runPostDeletionCleanupMock.mockReturnValue(seamPromise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    // The seam promise is intentionally never resolved in this test — if the
    // goodbye render awaited it, this assertion would time out.
    await waitFor(() => {
      expect(
        screen.getByText(
          'Your account has been deleted. Server-side cleanup will complete within 30 days. Goodbye.'
        )
      ).toBeTruthy()
    })
  })

  it('a failed cleanup seam does not block or alter the goodbye state (metadata-only, non-blocking)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    runPostDeletionCleanupMock.mockRejectedValue(new Error('signOut failed'))

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
    })
    // Give the rejected seam promise's microtask a chance to run; the flag
    // stays set (a later boot-time resume step owns clearing it on failure).
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
  })

  it('shows a single route-home affordance whose press routes to "/"', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-return-home')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-return-home'))

    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('the goodbye state announces via a role="status" region', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-account-goodbye').getAttribute('role')).toBe('status')
    })
  })

  it('the goodbye state and its route-home button SURVIVE a signOut()-driven isAuthenticated flip (entry-only gating — the mounted Dialog must not unmount)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })

    const props = baseProps()
    render(React.createElement(DeleteAccountFlow, props))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())

    // Simulate the cleanup seam's signOut() nulling the session /
    // isAuthenticated flag WHILE the terminal state is on screen.
    act(() => {
      isAuthenticated$.set(false)
    })

    expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
    expect(screen.getByTestId('btn-return-home')).toBeTruthy()
    fireEvent.click(screen.getByTestId('btn-return-home'))
    expect(pushSpy).toHaveBeenCalledWith('/')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup-failure sub-line — reactive, additive, non-blocking; reconciled
// with the fire-and-forget goodbye above (never a second terminal screen)
// ─────────────────────────────────────────────────────────────────────────────

const CLEANUP_FAILED_COPY =
  "Local cleanup didn't finish. Server-side deletion is complete. Reinstalling the app will fully clear local state."

describe('Cleanup-failure sub-line — additive to the existing terminal state, never a second screen', () => {
  it('surfaces the calm cleanup-failure copy inside the goodbye terminal state when the fire-and-forget seam rejects while it is still mounted', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    runPostDeletionCleanupMock.mockRejectedValue(new Error('signOut failed'))

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())

    const subline = await waitFor(() => screen.getByText(CLEANUP_FAILED_COPY))
    const statusRegion = subline.closest('[role="status"]')
    expect(statusRegion, 'cleanup-failure copy must live inside a role="status" region').toBeTruthy()
    expect(statusRegion?.getAttribute('aria-live')).toBe('polite')
  })

  it('does NOT show the cleanup-failure copy when the seam resolves cleanly', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    runPostDeletionCleanupMock.mockResolvedValue(undefined)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())
    // Give the resolved seam's microtask a chance to run before asserting absence.
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByText(CLEANUP_FAILED_COPY)).toBeNull()
  })

  it('does NOT show the cleanup-failure copy while the seam is still pending (only appears on an actual rejection)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const { promise: seamPromise } = deferred<void>()
    runPostDeletionCleanupMock.mockReturnValue(seamPromise)

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())

    expect(screen.queryByText(CLEANUP_FAILED_COPY)).toBeNull()
  })

  it('surfaces the same cleanup-failure copy on the native-action terminal leg', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })
    runPostDeletionCleanupMock.mockRejectedValue(new Error('signOut failed'))

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue')) // past the subscription warning
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-native-action')).toBeTruthy())
    await waitFor(() => expect(screen.getByText(CLEANUP_FAILED_COPY)).toBeTruthy())
  })

  it('adds no second affordance — the existing route-home button remains the only Done action even when the sub-line is showing', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    runPostDeletionCleanupMock.mockRejectedValue(new Error('signOut failed'))

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByText(CLEANUP_FAILED_COPY)).toBeTruthy())

    expect(screen.getByTestId('btn-return-home')).toBeTruthy()
    fireEvent.click(screen.getByTestId('btn-return-home'))
    expect(pushSpy).toHaveBeenCalledWith('/')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requires_native_subscription_action — native-action terminal leg
// ─────────────────────────────────────────────────────────────────────────────

describe('requires_native_subscription_action: true — native-action terminal variant', () => {
  it('shows the deleted confirmation PLUS a native store deep-link for apple_iap', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue')) // past the subscription warning
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Your account has been deleted. Server-side cleanup will complete within 30 days. Goodbye.'
        )
      ).toBeTruthy()
    })
    expect(screen.getByTestId('btn-open-app-store')).toBeTruthy()
    expect(
      screen.getByText('If nothing opened, manage your subscription in the App Store settings.')
    ).toBeTruthy()
  })

  it('shows the Play Store deep-link variant for play_iap', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'play_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: 'gpa.token.1',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue'))
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-open-play-store')).toBeTruthy())
    expect(
      screen.getByText('If nothing opened, manage your subscription in the Play Store settings.')
    ).toBeTruthy()
  })

  it('tapping the deep-link calls Linking.openURL with the store subscriptions URL', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue'))
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-open-app-store')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-open-app-store'))

    await waitFor(() => {
      expect(openURLMock).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions')
    })
  })

  it('still offers the route-home affordance alongside the native-action deep-link', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue'))
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-return-home')).toBeTruthy())
  })

  it('the SERVER flag is authoritative: with NO loaded client receipt it still enters native-action with generic both-stores guidance (never silently plain deleted)', async () => {
    // Receipt never loaded (null) — the client has no deep link to offer, but
    // the server says a native cancellation is still owed. Continued-billing
    // guidance must NOT be dropped.
    useSubscriptionReceiptMock.mockReturnValue(null)
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    // No subscription-warning step (no live receipt) — lands straight on confirm.
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-native-action')).toBeTruthy())
    // Generic fallback copy: calm, both stores named, and NO deep-link button.
    const guidance = screen.getByTestId('delete-account-native-action').textContent ?? ''
    expect(guidance).toContain('App Store')
    expect(guidance).toContain('Play Store')
    expect(screen.queryByTestId('btn-open-app-store')).toBeNull()
    expect(screen.queryByTestId('btn-open-play-store')).toBeNull()
    // Still terminal: goodbye + route-home remain.
    expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
    expect(screen.getByTestId('btn-return-home')).toBeTruthy()
  })

  it('the SERVER flag is authoritative: still-loading (undefined) receipt also enters native-action with generic guidance', async () => {
    useSubscriptionReceiptMock.mockReturnValue(undefined)
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: true,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-native-action')).toBeTruthy())
    expect(screen.queryByTestId('btn-open-app-store')).toBeNull()
    expect(screen.queryByTestId('btn-open-play-store')).toBeNull()
  })

  it('server flag FALSE lands on plain deleted with no native-action guidance even when a native receipt is loaded', async () => {
    useSubscriptionReceiptMock.mockReturnValue({
      provider: 'apple_iap',
      status: 'active',
      current_period_end: '2026-08-14T00:00:00Z',
      provider_subscription_id: '1000000123',
    })
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-continue'))
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())
    expect(screen.queryByTestId('delete-account-native-action')).toBeNull()
    expect(screen.queryByTestId('btn-open-app-store')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — calm, retryable, never a partial-deletion state
// ─────────────────────────────────────────────────────────────────────────────

describe('Error handling — calm retryable state, no lockout, no partial-deletion ambiguity', () => {
  it('shows a calm inline error message on failure (role="status")', async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-account-error').getAttribute('role')).toBe('status')
    })
  })

  it('shows a single Retry affordance on failure', async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
  })

  it('never renders any "deletion pending / partially deleted" ambiguity copy', async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    expect(screen.queryByText(/pending|partial(ly)? delet|might not have worked/i)).toBeNull()
  })

  it('"Keep my account" remains available in the error state — never a dark-pattern lockout', async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())
    expect(screen.getByTestId('btn-keep-my-account').hasAttribute('disabled')).toBe(false)
  })

  it('pressing Retry re-invokes deleteMyAccount()', async () => {
    deleteMyAccountMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    deleteMyAccountMock.mockResolvedValueOnce({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    fireEvent.click(screen.getByTestId('btn-retry'))

    await waitFor(() => expect(deleteMyAccountMock).toHaveBeenCalledTimes(2))
  })

  it('Retry converging to success eventually shows the goodbye screen', async () => {
    deleteMyAccountMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    deleteMyAccountMock.mockResolvedValueOnce({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    fireEvent.click(screen.getByTestId('btn-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
    })
  })

  it('a Retry double-tap fires only one re-invocation (double-fire guard also covers Retry)', async () => {
    deleteMyAccountMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' })

    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    const { promise } = deferred<any>()
    deleteMyAccountMock.mockReturnValue(promise)
    const retryBtn = screen.getByTestId('btn-retry')
    fireEvent.click(retryBtn)
    fireEvent.click(retryBtn)

    expect(deleteMyAccountMock).toHaveBeenCalledTimes(2) // 1 initial + 1 retry (2nd tap swallowed)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dialog lifecycle — reset on reopen
// ─────────────────────────────────────────────────────────────────────────────

describe('Dialog lifecycle — reset on reopen', () => {
  it('reopening after an error resets to the warning step (no stale error + one-tap Retry)', async () => {
    deleteMyAccountMock.mockResolvedValue({ ok: false, status: 500, code: 'internal' })
    const props = baseProps()
    const { rerender } = render(React.createElement(DeleteAccountFlow, props))

    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-retry')).toBeTruthy())

    rerender(React.createElement(DeleteAccountFlow, { ...props, open: false }))
    rerender(React.createElement(DeleteAccountFlow, { ...props, open: true }))

    expect(screen.getByTestId('delete-account-warning')).toBeTruthy()
    expect(screen.queryByTestId('btn-retry')).toBeNull()
  })

  it('reopening after the confirm step resets to the warning step (does not resume mid-flow)', () => {
    const props = baseProps()
    const { rerender } = render(React.createElement(DeleteAccountFlow, props))

    proceedPastWarningAndEmail()
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()

    rerender(React.createElement(DeleteAccountFlow, { ...props, open: false }))
    rerender(React.createElement(DeleteAccountFlow, { ...props, open: true }))

    expect(screen.getByTestId('delete-account-warning')).toBeTruthy()
    expect(screen.queryByTestId('delete-account-confirm-step')).toBeNull()
  })

  it('reopening after the goodbye terminal state re-presents the SAME goodbye (terminal latch — never a fresh delete flow for an already-deleted account)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const props = baseProps()
    const { rerender } = render(React.createElement(DeleteAccountFlow, props))

    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())

    rerender(React.createElement(DeleteAccountFlow, { ...props, open: false }))
    rerender(React.createElement(DeleteAccountFlow, { ...props, open: true }))

    // The latch holds: the same terminal screen returns, and the warning
    // (fresh-flow) step is never re-presented for an already-deleted account.
    expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
    expect(screen.queryByTestId('delete-account-warning')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dismissal semantics — non-dismissable in flight; terminal closes only via
// its explicit buttons; pre-confirm escape stays live
// ─────────────────────────────────────────────────────────────────────────────

describe('Dismissal semantics — the confirmation UX is the safety mechanism', () => {
  it('a backdrop/escape dismissal at a PRE-confirm step still closes (Keep-my-account escape stays live)', () => {
    const onOpenChange = vi.fn()
    render(React.createElement(DeleteAccountFlow, baseProps({ onOpenChange })))

    // At the warning step, an implicit dismissal is honored.
    fireEvent.click(screen.getByTestId('dialog-backdrop-dismiss'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('CANNOT be dismissed via backdrop/escape while the deletion is in flight (an irreversible op must not appear to vanish)', async () => {
    const { promise } = deferred<any>()
    deleteMyAccountMock.mockReturnValue(promise)
    const onOpenChange = vi.fn()

    render(React.createElement(DeleteAccountFlow, baseProps({ onOpenChange })))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))

    await waitFor(() =>
      expect(screen.getByTestId('btn-delete-my-account').hasAttribute('disabled')).toBe(true)
    )

    // Backdrop tap during `deleting` is intercepted — parent open-state untouched.
    fireEvent.click(screen.getByTestId('dialog-backdrop-dismiss'))
    expect(onOpenChange).not.toHaveBeenCalled()
    // The confirm surface is still mounted (not silently closed).
    expect(screen.getByTestId('delete-account-confirm-step')).toBeTruthy()
  })

  it('CANNOT be dismissed via backdrop/escape in the terminal goodbye state (closes only via its explicit button)', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const onOpenChange = vi.fn()

    render(React.createElement(DeleteAccountFlow, baseProps({ onOpenChange })))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy())

    fireEvent.click(screen.getByTestId('dialog-backdrop-dismiss'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('delete-account-goodbye')).toBeTruthy()
  })

  it('the terminal "Return home" button closes the dialog (onOpenChange(false)) BEFORE routing home', async () => {
    deleteMyAccountMock.mockResolvedValue({
      ok: true,
      deleted_at: '2026-07-15T00:00:00Z',
      requires_native_subscription_action: false,
    })
    const onOpenChange = vi.fn()

    render(React.createElement(DeleteAccountFlow, baseProps({ onOpenChange })))
    proceedPastWarningAndEmail()
    fireEvent.click(screen.getByTestId('btn-delete-my-account'))
    await waitFor(() => expect(screen.getByTestId('btn-return-home')).toBeTruthy())

    fireEvent.click(screen.getByTestId('btn-return-home'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushSpy).toHaveBeenCalledWith('/')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility
// ─────────────────────────────────────────────────────────────────────────────

describe('Accessibility', () => {
  it('renders with role="dialog" and aria-modal when open', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('does not render the dialog role when closed', () => {
    render(React.createElement(DeleteAccountFlow, baseProps({ open: false })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the warning step exposes accessible labels on Continue and Keep my account', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    expect(screen.getByTestId('btn-continue').getAttribute('aria-label')).toBeTruthy()
    expect(screen.getByTestId('btn-keep-my-account').getAttribute('aria-label')).toBeTruthy()
  })

  it('the final confirm ExpandingLineButton carries an unambiguous accessibilityLabel', () => {
    render(React.createElement(DeleteAccountFlow, baseProps()))
    proceedPastWarningAndEmail()
    expect(screen.getByTestId('btn-delete-my-account').getAttribute('aria-label')).toBeTruthy()
  })
})
