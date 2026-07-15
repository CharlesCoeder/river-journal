/**
 * DeleteAccountFlow — the locked-Dialog 3-step account-deletion confirmation.
 *
 * A controlled modal Dialog (cloned structurally from `CancelSubscriptionFlow`)
 * that walks the user through an irreversible, honestly-disclosed account
 * deletion in three deliberate steps — never a single tap:
 *
 *   warning → email → (subscription-warning | skip) → confirm
 *     → deleting → deleted | native-action | error
 *
 * Step 1 (warning): plain-language disclosure of exactly what deletion does,
 *   including the anonymize-vs-delete distinction and the escape hatch of
 *   deleting an individual Collective post first for full erasure.
 * Step 2 (email): type-your-own-email-to-confirm gate (trimmed,
 *   case-insensitive, non-empty). A null OR empty/whitespace-only session email
 *   while authenticated (e.g. phone-only auth) lands on the calm error state
 *   rather than allowing progression.
 * Conditional (subscription-warning): inserted only when the caller has a live
 *   (active/past_due) subscription receipt, naming the billing provider. A
 *   still-loading/undefined receipt is treated as "no known subscription" —
 *   advisory only, never a gate.
 * Step 3 (confirm): the signature underline-grow CTA fires `deleteMyAccount()`.
 *
 * On `ok`: the pending-cleanup flag is set FIRST, then the post-deletion local
 * cleanup seam is fired-and-forgotten (never awaited — the goodbye renders
 * synchronously and survives the sign-out-driven session flip), then the
 * terminal goodbye (or native-action) state renders. Any error is calm and
 * retryable — never a partial-deletion ambiguity, never a lockout.
 *
 * Dismissal: while `deleting`, the dialog cannot be dismissed at all (an
 * in-flight irreversible operation must never appear to vanish/fail). In the
 * terminal states (`deleted`/`native-action`) the backdrop/escape are inert —
 * the surface closes only through its explicit buttons. Every pre-confirm step
 * keeps its live "Keep my account" escape.
 *
 * Reset-on-reopen: a dialog dismissed mid-flow or mid-error ALWAYS reopens on a
 * clean warning step. Once terminal, a latch holds — reopening re-presents the
 * same terminal screen, never a fresh delete flow for an already-deleted
 * account. The mounted Dialog is driven by its own `open`/step state — the
 * hosting screen gates only the entry trigger on auth, so the terminal state
 * survives `signOut()` nulling the session.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, Input, Text, XStack, YStack, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { deviceState$ } from 'app/state/syncConfig'
import { deleteMyAccount } from 'app/utils/billing/subscriptionApi'
import type { BillingProvider } from 'app/utils/billing/subscriptionApi'
import { useSubscriptionReceipt } from 'app/state/subscriptionReceipt'
import { runPostDeletionCleanup } from 'app/state/accountCleanup'
import { useRouter } from 'solito/navigation'
import { resolveNativeStoreLink } from 'app/features/paid/nativeStoreLinks'
import type { NativeStoreLink } from 'app/features/paid/nativeStoreLinks'

// react-native's Linking, resolved via a deferred dynamic import rather than a
// top-level `import { Linking } from 'react-native'` so the web bundle never
// statically pulls in react-native. react-native-web maps Linking on web, so a
// single cross-platform path works. A failed warm-up does not latch.
let cachedLinking: typeof import('react-native').Linking | null = null
let linkingWarmPromise: Promise<typeof import('react-native').Linking | null> | null = null

function warmLinking(): Promise<typeof import('react-native').Linking | null> {
  if (cachedLinking !== null) return Promise.resolve(cachedLinking)
  if (linkingWarmPromise === null) {
    linkingWarmPromise = import('react-native')
      .then((rn) => {
        cachedLinking = rn.Linking
        return cachedLinking
      })
      .catch((error) => {
        linkingWarmPromise = null
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[delete-account] failed to resolve react-native Linking', error)
        }
        return null
      })
  }
  return linkingWarmPromise
}

function openStoreLink(url: string): void {
  if (cachedLinking !== null) {
    void cachedLinking.openURL(url).catch(() => {})
    return
  }
  void warmLinking().then((linking) => {
    void linking?.openURL(url).catch(() => {})
  })
}

// Provider display names for the pre-confirm subscription warning. These are the
// contractual product literals ("Stripe" / "App Store" / "Play Store") that read
// grammatically in prose ("cancel it via the App Store"). They intentionally
// coincide with the native-store deep-link's `storeName` for the store cases,
// but this mapping is the source of truth for the warning copy.
function providerDisplayName(provider: BillingProvider): string {
  switch (provider) {
    case 'stripe':
      return 'Stripe'
    case 'apple_iap':
      return 'App Store'
    case 'play_iap':
      return 'Play Store'
  }
}

const GOODBYE_COPY =
  'Your account has been deleted. Server-side cleanup will complete within 30 days. Goodbye.'

// Calm, non-alarming sub-line shown only when the fire-and-forget local-cleanup
// seam later rejects while the goodbye is still mounted. Server-side deletion is
// already committed (the `ok` response is authoritative), so this is a local-only
// reassurance — never a "partial deletion / might not have worked" state.
const CLEANUP_FAILED_COPY =
  "Local cleanup didn't finish. Server-side deletion is complete. Reinstalling the app will fully clear local state."

type FlowState =
  | 'warning'
  | 'email'
  | 'subscription-warning'
  | 'confirm'
  | 'deleting'
  | 'deleted'
  | 'native-action'
  | 'error'

export interface DeleteAccountFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteAccountFlow({ open, onOpenChange }: DeleteAccountFlowProps) {
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  const expectedEmail = use$(store$.session.email) as string | null
  const userId = use$(store$.session.userId) as string | null
  const receipt = useSubscriptionReceipt(userId)

  const [state, setState] = useState<FlowState>('warning')
  const [typedEmail, setTypedEmail] = useState('')
  const [nativeLink, setNativeLink] = useState<NativeStoreLink | null>(null)
  // Reactive, additive sub-line: set true only if the fire-and-forget cleanup
  // seam rejects while the terminal goodbye is still mounted (the normal case is
  // it resolves in a few ms and this never flips). Never blocks/delays goodbye.
  const [cleanupFailed, setCleanupFailed] = useState(false)
  const inFlightRef = useRef(false)

  const router = useRouter()

  // Warm the react-native Linking cache so the store deep-link can open promptly
  // once the native-action screen is reached.
  useEffect(() => {
    warmLinking()
  }, [])

  // Reset the state machine on every closed→open transition — EXCEPT once the
  // flow has reached a terminal state. A dialog dismissed mid-flow (or mid-error)
  // always reopens on a clean warning step; but once the account is deleted
  // (`deleted`/`native-action`) the terminal latch holds — reopening re-presents
  // the same terminal screen, never a fresh delete flow for an already-deleted
  // account (which would 401 into a falsely-reassuring "nothing was deleted").
  const prevOpenRef = useRef(open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const isTerminal = state === 'deleted' || state === 'native-action'
      if (!isTerminal) {
        setState('warning')
        setTypedEmail('')
        setNativeLink(null)
        setCleanupFailed(false)
        inFlightRef.current = false
      }
    }
    prevOpenRef.current = open
  }, [open, state])

  // Whether the caller has a live subscription worth pre-warning about. A
  // still-loading/undefined receipt is treated the same as "no known
  // subscription" — advisory only, never gates progression.
  const hasLiveSubscription = receipt?.status === 'active' || receipt?.status === 'past_due'

  const receiptNativeLink =
    receipt && (receipt.provider === 'apple_iap' || receipt.provider === 'play_iap')
      ? resolveNativeStoreLink(receipt.provider)
      : null

  // A null OR empty/whitespace-only session email (e.g. phone-only auth) cannot
  // anchor the typed-email gate — it is treated exactly like a missing email:
  // the calm error state, never progression.
  const normalizedExpectedEmail = expectedEmail?.trim().toLowerCase() ?? ''
  const hasValidExpectedEmail = normalizedExpectedEmail !== ''

  const emailMatches =
    hasValidExpectedEmail &&
    typedEmail.trim() !== '' &&
    typedEmail.trim().toLowerCase() === normalizedExpectedEmail

  const handleKeep = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleReturnHome = useCallback(() => {
    // Explicit terminal exit: close the dialog (so the parent open-state does not
    // stay stuck true) before routing home.
    onOpenChange(false)
    router.push('/')
  }, [onOpenChange, router])

  const handleContinueFromWarning = useCallback(() => {
    setState('email')
  }, [])

  const handleContinueFromEmail = useCallback(() => {
    if (!emailMatches) return
    setState(hasLiveSubscription ? 'subscription-warning' : 'confirm')
  }, [emailMatches, hasLiveSubscription])

  const handleContinueFromSubscriptionWarning = useCallback(() => {
    setState('confirm')
  }, [])

  const runDelete = useCallback(async () => {
    // Double-fire guard — a double-tap or a rapid Retry must fire only one call.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setState('deleting')

    try {
      const result = await deleteMyAccount()

      if (result.ok) {
        // Flag FIRST — a mid-cleanup app close is recoverable on next boot (the
        // marker is persisted + device-scoped, so it survives the sign-out the
        // seam performs and drives boot-resume on the next launch).
        deviceState$.pendingAccountCleanup.set(true)
        // Fire-and-forget: never await the seam. The goodbye renders
        // synchronously below; a slow/failed sign-out must not delay or block
        // the confirmation. On rejection, surface the calm cleanup-failure
        // sub-line reactively (no second screen). Log is metadata-only.
        void runPostDeletionCleanup().catch((err) => {
          console.warn(
            '[delete-account] post-deletion cleanup seam failed',
            err instanceof Error ? err.message : 'unknown error'
          )
          setCleanupFailed(true)
        })

        // The SERVER flag is authoritative for whether the user must still cancel
        // a native store subscription. When it is set we ALWAYS enter
        // native-action — using the client-receipt deep link when one is
        // available, and a generic both-stores guidance line when the receipt
        // was null/still-loading. We must never silently drop to plain `deleted`
        // when the server says a native cancellation is still owed (continued
        // billing).
        if (result.requires_native_subscription_action) {
          setNativeLink(receiptNativeLink)
          setState('native-action')
        } else {
          setNativeLink(null)
          setState('deleted')
        }
      } else {
        // Any error means nothing was committed server-side — safe to retry.
        setState('error')
      }
    } finally {
      inFlightRef.current = false
    }
  }, [receiptNativeLink])

  const isDeleting = state === 'deleting'
  const isTerminal = state === 'deleted' || state === 'native-action'

  // Dismissal semantics for the implicit (escape / overlay-tap) exits routed
  // through the Dialog's own `onOpenChange`. The explicit "Keep my account" and
  // "Return home" buttons call `onOpenChange(false)` directly and are never
  // intercepted here — the safety escape stays live at every pre-confirm step.
  //   - While `deleting`: an irreversible operation is in flight. Suppress the
  //     dismissal entirely so the user never sees the surface vanish and assume
  //     it failed.
  //   - Terminal (`deleted`/`native-action`): the account is gone. Dismissal is
  //     allowed only via the explicit buttons, never a stray backdrop tap.
  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next && (isDeleting || isTerminal)) return
      onOpenChange(next)
    },
    [isDeleting, isTerminal, onOpenChange]
  )

  // Belt-and-suspenders for platforms where the escape key / outside-press fire
  // ahead of `onOpenChange`: when the dialog is non-dismissable, prevent the
  // default dismissal at the source per the Tamagui Dialog (Radix) API.
  const dismissDisabled = isDeleting || isTerminal
  const preventImplicitDismiss = useCallback(
    (event: { preventDefault: () => void }) => {
      if (dismissDisabled) event.preventDefault()
    },
    [dismissDisabled]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="delete-overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="delete-content"
          gap="$3"
          padding="$4"
          maxWidth={460}
          width="90%"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          animation={animationToken}
          onEscapeKeyDown={preventImplicitDismiss}
          onPointerDownOutside={preventImplicitDismiss}
          onInteractOutside={preventImplicitDismiss}
        >
          <Dialog.Title
            fontSize="$5"
            fontFamily="$body"
          >
            Delete account
          </Dialog.Title>

          {/* Step 1 — plain-language warning */}
          {state === 'warning' && (
            <YStack
              testID="delete-account-warning"
              gap="$2"
            >
              <Text
                fontSize="$3"
                color="$color12"
              >
                Deleting your account will:
              </Text>
              <Text
                fontSize="$3"
                color="$color12"
              >
                {'• Permanently delete your journal entries, reminders, themes, and account data.'}
              </Text>
              <Text
                fontSize="$3"
                color="$color12"
              >
                {'• '}
                <Text fontWeight="700">Anonymize</Text>
                {
                  ' your Collective posts and reactions. The text of your posts will remain visible to the Collective, but your name will be removed and cannot be linked back to you. (This preserves the conversations other people built with your contributions.)'
                }
              </Text>
              <Text
                fontSize="$3"
                color="$color12"
              >
                {'• Cancel any active subscription via your billing provider.'}
              </Text>
              <Text
                fontSize="$3"
                color="$color12"
              >
                This cannot be undone. Server-side cleanup will complete within 30 days.
              </Text>
              <Text
                fontSize="$3"
                color="$color11"
              >
                {
                  "If you want a specific Collective post fully erased (text and all), delete it individually first — that replaces the text with '[deleted]'."
                }
              </Text>
            </YStack>
          )}

          {/* Step 2 — typed-email confirmation, OR the calm error state when the
              session email is somehow null (or empty/whitespace-only, e.g.
              phone-only auth) while authenticated. */}
          {state === 'email' &&
            (!hasValidExpectedEmail ? (
              <YStack
                testID="delete-account-error"
                role="status"
                aria-live="polite"
                gap="$2"
              >
                <Text
                  fontSize="$3"
                  color="$color11"
                >
                  We couldn't confirm your account details. Nothing was deleted. Please try again
                  later.
                </Text>
              </YStack>
            ) : (
              <YStack
                testID="delete-account-email-step"
                gap="$2"
              >
                <Text
                  fontSize="$3"
                  color="$color12"
                >
                  {`To confirm, type your email address: ${expectedEmail}`}
                </Text>
                <Input
                  testID="delete-email-input"
                  value={typedEmail}
                  onChangeText={setTypedEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  borderColor="$color5"
                  color="$color"
                />
              </YStack>
            ))}

          {/* Conditional — active-subscription warning */}
          {state === 'subscription-warning' && receipt && (
            <YStack gap="$2">
              <Text
                testID="delete-account-subscription-warning"
                fontSize="$3"
                color="$color12"
              >
                {`You have an active ${providerDisplayName(receipt.provider)} subscription. Deleting your account will cancel it via ${providerDisplayName(receipt.provider)}. If your provider requires native confirmation, you'll be directed there after this step.`}
              </Text>
            </YStack>
          )}

          {/* Step 3 — final confirm */}
          {(state === 'confirm' || state === 'deleting') && (
            <YStack
              testID="delete-account-confirm-step"
              gap="$2"
            >
              <Text
                fontSize="$3"
                color="$color12"
              >
                This is your last step. Deleting your account cannot be undone.
              </Text>
            </YStack>
          )}

          {/* Error — calm, retryable, never a partial-deletion ambiguity */}
          {state === 'error' && (
            <YStack
              testID="delete-account-error"
              role="status"
              aria-live="polite"
              gap="$2"
            >
              <Text
                fontSize="$3"
                color="$color11"
              >
                Something went wrong and nothing was deleted. Please try again.
              </Text>
            </YStack>
          )}

          {/* Terminal — goodbye (shared by the plain and native-action legs) */}
          {(state === 'deleted' || state === 'native-action') && (
            <YStack
              testID="delete-account-goodbye"
              role="status"
              aria-live="polite"
              gap="$2"
            >
              <Text
                fontSize="$3"
                color="$color12"
              >
                {GOODBYE_COPY}
              </Text>
              {/* Reactive, additive cleanup-failure sub-line. Appears only if the
                  fire-and-forget seam rejected while this terminal state is still
                  mounted — never a second screen, never a second button; the
                  route-home CTA below IS the Done affordance. Lives inside this
                  role="status"/aria-live="polite" region so it announces calmly. */}
              {cleanupFailed && (
                <Text
                  testID="delete-account-cleanup-failed"
                  fontSize="$2"
                  color="$color11"
                >
                  {CLEANUP_FAILED_COPY}
                </Text>
              )}
            </YStack>
          )}

          {state === 'native-action' && (
            <YStack
              testID="delete-account-native-action"
              gap="$2"
            >
              <Text
                fontSize="$2"
                color="$color11"
              >
                {nativeLink
                  ? `If nothing opened, manage your subscription in the ${nativeLink.storeName} settings.`
                  : "You may still have an active subscription. To stop future charges, cancel it in your device's App Store (Apple) or Play Store (Google) subscription settings."}
              </Text>
            </YStack>
          )}

          {/* Action row — step-specific affordances */}
          <XStack
            gap="$3"
            justifyContent="flex-end"
            marginTop="$3"
            flexWrap="wrap"
          >
            {state === 'warning' && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep my account"
                >
                  Keep my account
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={handleContinueFromWarning}
                  accessibilityLabel="Continue"
                >
                  Continue
                </ExpandingLineButton>
              </>
            )}

            {state === 'email' && !hasValidExpectedEmail && (
              <ExpandingLineButton
                onPress={handleKeep}
                accessibilityLabel="Keep my account"
              >
                Keep my account
              </ExpandingLineButton>
            )}

            {state === 'email' && hasValidExpectedEmail && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep my account"
                >
                  Keep my account
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={handleContinueFromEmail}
                  disabled={!emailMatches}
                  accessibilityLabel="Continue"
                >
                  Continue
                </ExpandingLineButton>
              </>
            )}

            {state === 'subscription-warning' && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep my account"
                >
                  Keep my account
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={handleContinueFromSubscriptionWarning}
                  accessibilityLabel="Continue"
                >
                  Continue
                </ExpandingLineButton>
              </>
            )}

            {(state === 'confirm' || state === 'deleting') && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  disabled={isDeleting}
                  accessibilityLabel="Keep my account"
                >
                  Keep my account
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={runDelete}
                  disabled={isDeleting}
                  accessibilityLabel="Delete my account"
                >
                  Delete my account
                </ExpandingLineButton>
              </>
            )}

            {state === 'error' && (
              <>
                <ExpandingLineButton
                  onPress={handleKeep}
                  accessibilityLabel="Keep my account"
                >
                  Keep my account
                </ExpandingLineButton>
                <ExpandingLineButton
                  onPress={runDelete}
                  accessibilityLabel="Retry"
                >
                  Retry
                </ExpandingLineButton>
              </>
            )}

            {(state === 'deleted' || state === 'native-action') && (
              <>
                {state === 'native-action' && nativeLink && (
                  <ExpandingLineButton
                    onPress={() => openStoreLink(nativeLink.url)}
                    accessibilityLabel={nativeLink.label}
                  >
                    {nativeLink.label}
                  </ExpandingLineButton>
                )}
                <ExpandingLineButton
                  onPress={handleReturnHome}
                  accessibilityLabel="Return home"
                >
                  Return home
                </ExpandingLineButton>
              </>
            )}
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default DeleteAccountFlow
