/**
 * ModerationReceiptDialog — the user-facing moderation receipt surface.
 *
 * A controlled, locked Dialog (mirrors the locked admin-dialog styling —
 * overlay $shadow6, content $background/$color3 1px, maxWidth 420 / width 90%,
 * reduced-motion-gated animation) but lives OUTSIDE the admin moderation
 * subtree because it ships to web + desktop + mobile (that subtree is
 * mobile-excluded). It therefore imports NOTHING from the admin moderation
 * feature tree.
 *
 * Design (persona findings):
 *   - The dismiss button reads "Got it", NOT "Acknowledge" — to a user who
 *     believes they were moderated in error the literal word "Acknowledge"
 *     reads as compelled admission of wrongdoing. The ack MECHANISM (the
 *     persisted timestamp) is unchanged; only the visible label softens.
 *   - No Appeal / Dispute / Contact-us affordance — no appeal system exists,
 *     so a dead-ending control would be a false promise. The guidelines link
 *     is the only outward path, framed as the constructive way back.
 *   - No tap-outside / Esc dismiss — the receipt must be explicitly dismissed
 *     (open is driven fully by the parent gate; onOpenChange is a no-op so a
 *     stray outside-press / Escape can't close it).
 *
 * Props: `{ receipt, onAcknowledge }`. Presence/absence is driven by the parent
 * gate conditionally mounting the dialog (one-at-a-time queue) — hence no
 * `open`/`onOpenChange` in the prop contract.
 */

import { Dialog, Text, XStack, YStack, ExpandingLineButton, useReducedMotion } from '@my/ui'
import { reasonLabel, COMMUNITY_GUIDELINES_URL } from './reasonLabels'

// react-native's Linking, resolved via a deferred dynamic import rather than a
// top-level `import { Linking } from 'react-native'`. react-native-web maps
// Linking on web, so a single cross-platform path works. We warm the module the
// first time the dialog renders (see `warmLinking`) and cache the reference so
// the press handler can open the URL synchronously — a receipt shown to the user
// sits on screen far longer than the microtask warm-up needs, so the cache is
// normally populated by the time they tap. Two robustness guarantees on top:
//   - a tap that lands before the warm-up resolves falls back to resolving the
//     module on demand (never a silent no-op), and
//   - a failed warm-up does not latch: the in-flight promise is cleared so the
//     press handler's fallback can retry instead of leaving the link dead for
//     the rest of the session.
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
        // Best-effort: the guidelines link degrades to a no-op rather than a
        // crash, but the failure must be retryable and observable (dev-only,
        // metadata-free — never user content).
        linkingWarmPromise = null
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[moderation-receipts] failed to resolve react-native Linking', error)
        }
        return null
      })
  }
  return linkingWarmPromise
}

function openCommunityGuidelines(): void {
  if (cachedLinking !== null) {
    // Warm path: open synchronously at press time.
    void cachedLinking.openURL(COMMUNITY_GUIDELINES_URL).catch(() => {
      // openURL itself can reject (no handler for the scheme); swallowing keeps
      // the dialog calm — there is no in-app fallback route in scope.
    })
    return
  }
  // Cold path: the tap beat the render-time warm-up (or it failed) — resolve on
  // demand so the only outward affordance in the receipt is never a dead link.
  void warmLinking().then((linking) => {
    void linking?.openURL(COMMUNITY_GUIDELINES_URL).catch(() => {})
  })
}

// ─── Receipt type — a discriminated union carrying NO post title/body ──────────
export type ModerationReceipt =
  | {
      kind: 'removed_post'
      id: string
      parent_post_id: string | null
      created_at: string
      removed_reason: string | null
      removed_at: string
    }
  | {
      kind: 'suspension'
      id: string
      // Scope note: the "post and react" copy assumes user_suspensions.kind is
      // CHECK-constrained to the single MVP value 'post_react'. If a future
      // migration broadens that CHECK, this copy MUST be revisited.
      ends_at: string
      reason: string | null
    }

export interface ModerationReceiptDialogProps {
  receipt: ModerationReceipt
  onAcknowledge: () => void
}

// Human-readable date — matches the app's existing human-date format
// (HomeScreen uses toLocaleDateString('en-US', ...)). This derived display
// value is SEPARATE from the receiptId key, which uses the raw removed_at.
function humanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ModerationReceiptDialog({ receipt, onAcknowledge }: ModerationReceiptDialogProps) {
  // Warm the react-native Linking cache on first render so the guidelines link
  // can open synchronously at press time.
  warmLinking()
  const reducedMotion = useReducedMotion()
  const animationToken = reducedMotion ? undefined : 'quick'

  // Neutral title for both variants — deliberately avoids the words the body
  // copy uses ("removed", "paused") so a single body assertion never collides
  // with the heading, and the heading stays calm/non-accusatory.
  const title = 'Moderation notice'

  // Suspension reason is shown verbatim (free text the user is entitled to);
  // when null/blank the "Reason:" line is omitted entirely (no dangling label).
  const suspensionReason =
    receipt.kind === 'suspension' && receipt.reason != null && receipt.reason.trim() !== ''
      ? receipt.reason
      : null

  return (
    <Dialog
      open
      onOpenChange={() => {
        // Intentional no-op: the receipt must be dismissed via the explicit
        // "Got it" button. Ignoring onOpenChange blocks tap-outside / Esc close.
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="overlay"
          backgroundColor="$shadow6"
          animation={animationToken}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="content"
          gap="$3"
          padding="$4"
          maxWidth={420}
          width="90%"
          backgroundColor="$background"
          borderColor="$color3"
          borderWidth={1}
          animation={animationToken}
        >
          <Dialog.Title fontSize="$5" fontFamily="$body">
            {title}
          </Dialog.Title>

          <YStack gap="$2">
            {receipt.kind === 'removed_post' ? (
              <Text fontSize="$3" color="$color12">
                {`A ${receipt.parent_post_id !== null ? 'reply' : 'post'} you made on ${humanDate(
                  receipt.created_at
                )} was removed. Reason: ${reasonLabel(receipt.removed_reason)}.`}
              </Text>
            ) : (
              <>
                <Text fontSize="$3" color="$color12">
                  {`Your ability to post and react has been paused until ${humanDate(
                    receipt.ends_at
                  )}. You can still write and read.`}
                </Text>
                {suspensionReason !== null ? (
                  <Text fontSize="$3" color="$color11">
                    {`Reason: ${suspensionReason}`}
                  </Text>
                ) : null}
              </>
            )}
          </YStack>

          {/* Constructive path back — the only outward affordance (no appeal). */}
          <Text
            fontSize="$2"
            color="$color11"
            role="link"
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={openCommunityGuidelines}
          >
            View community guidelines
          </Text>

          <XStack gap="$3" justifyContent="flex-end" marginTop="$3">
            <ExpandingLineButton size="cta" onPress={onAcknowledge}>
              Got it
            </ExpandingLineButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export default ModerationReceiptDialog
