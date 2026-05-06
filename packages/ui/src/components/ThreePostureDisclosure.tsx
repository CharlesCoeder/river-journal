/**
 * ThreePostureDisclosure — presentational primitive
 *
 * Platform-agnostic disclosure dialog with two posture modes:
 *  - 'first-time': full-screen, no dismiss path (UX lock)
 *  - 'review':     dismissable via overlay, escape key, or close button
 *
 * This file MUST NOT import from @legendapp/state, @tanstack/react-query,
 * solito, or @my/app. All side effects live in the wrapper layer.
 *
 * Boundary B ('ai_cloud_v1') is structurally reserved but renders nothing
 * until the Growth-phase AI cloud surface ships.
 */

import React, { useEffect } from 'react'
import { Dialog, Text, YStack } from 'tamagui'
import { ExpandingLineButton } from './ExpandingLineButton'
import { useReducedMotion } from '../hooks/useReducedMotion'

// ─── Public types ─────────────────────────────────────────────────────────────

export type DisclosureBoundary = 'collective_post_v1' | 'ai_cloud_v1'
export type DisclosureMode = 'first-time' | 'review'

export interface ThreePostureDisclosureProps {
  boundary: DisclosureBoundary
  mode: DisclosureMode
  open: boolean
  onAcknowledge: () => void
  /** Called for `mode: 'review'` only (review is dismissable). */
  onRequestClose?: () => void
  /** Called when "View community guidelines" is tapped. */
  onViewGuidelines?: () => void
}

// ─── Heading element id for aria-labelledby ───────────────────────────────────
const TITLE_ID = 'three-posture-disclosure-title'

// ─── Stable id for the acknowledge/close button (focus management) ────────────
// ExpandingLineButton does not forwardRef (doing so changes its type in a way
// that breaks consumers under this repo's React/TS version mix). Instead we
// assign a stable DOM id and focus via document.getElementById — safe on web,
// a no-op on RN where getElementById returns null. The JSDOM test mock spreads
// ...rest, so the id flows through and focus() is exercised in tests.
const ACK_BUTTON_ID = 'three-posture-disclosure-ack-button'

// ─── Body copy — verbatim, regression-asserted in tests ─────────────────────
const BODY_COPY =
  'Posts in the Collective are visible to other members. Your journal entries stay private and encrypted.'

// ─────────────────────────────────────────────────────────────────────────────

export function ThreePostureDisclosure({
  boundary,
  mode,
  open,
  onAcknowledge,
  onRequestClose,
  onViewGuidelines,
}: ThreePostureDisclosureProps) {
  // Reserved for Growth-phase AI cloud disclosure — see Epic 3 context, Boundary B.
  // Boundary B ('ai_cloud_v1') renders nothing until the Growth AI cloud surface ships.
  if (boundary === 'ai_cloud_v1') {
    return null
  }

  // Boundary A ('collective_post_v1') ─────────────────────────────────────────
  return (
    <BoundaryADialog
      mode={mode}
      open={open}
      onAcknowledge={onAcknowledge}
      onRequestClose={onRequestClose}
      onViewGuidelines={onViewGuidelines}
    />
  )
}

// ─── Internal Boundary A Dialog ───────────────────────────────────────────────

interface BoundaryADialogProps {
  mode: DisclosureMode
  open: boolean
  onAcknowledge: () => void
  onRequestClose?: () => void
  onViewGuidelines?: () => void
}

// Tamagui Text / Dialog do not expose `tag` / non-standard props in their TypeScript
// types. Cast once at module level to keep JSX readable while suppressing the errors.
// These are valid runtime props on web — the casts do NOT change runtime behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TextAny = Text as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DialogAny = Dialog as any

function BoundaryADialog({
  mode,
  open,
  onAcknowledge,
  onRequestClose,
  onViewGuidelines,
}: BoundaryADialogProps) {
  const reduceMotion = useReducedMotion()

  // Focus management — move focus to the acknowledge button on open (both modes).
  //
  // Uses requestAnimationFrame to ensure the button is mounted in the DOM before
  // focus() is called (Radix/Tamagui portals + animations can delay mount).
  //
  // Both first-time and review modes focus the action button on open — the button's
  // text/handler differ by mode but the ref target is the same single button.
  //
  // We use document.getElementById(ACK_BUTTON_ID) rather than a ref because
  // ExpandingLineButton does not forwardRef (forwardRef changes its TypeScript type
  // in a way that breaks other consumers under this repo's React/TS version mix).
  // getElementById is safe on web and returns null on RN — the optional-chain
  // (?.focus()) makes the RN no-op explicit.
  //
  // On RN, setAccessibilityFocus() via AccessibilityInfo is deferred — this story's
  // primary surface is web (PostComposer is web-first per Epic 3 D6/D14). The RN focus
  // path will be added in Story 3.9 or a follow-up when the native composer ships.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        ;(document.getElementById(ACK_BUTTON_ID) as HTMLElement | null)?.focus()
      })
    }
  }, [open])

  const isFirstTime = mode === 'first-time'

  // Dismiss-control: the actual UX lock in production is this onOpenChange gate.
  //
  // Tamagui Dialog does NOT recognize dismissOnOverlayPress / disableEscapeKey as
  // top-level props (they are silently ignored at runtime in real Tamagui). The real
  // dismissal lock is implemented here: when mode === 'first-time', any close attempt
  // (overlay press, Escape key, or programmatic) is intercepted and dropped — the
  // dialog stays open until the user explicitly taps the acknowledge button.
  //
  // The props are still passed to the Dialog element (cast via `as any`) so that the
  // unit-test Dialog mock can read them for behavioral assertions. They have no effect
  // on the real Tamagui Dialog.
  const handleOpenChange = (next: boolean) => {
    if (!next && mode === 'review') {
      onRequestClose?.()
    }
    // In first-time mode, ignore any programmatic close attempt (UX lock).
  }

  const buttonLabel = isFirstTime ? 'Got it, post' : 'Close'
  const handleButtonPress = isFirstTime ? onAcknowledge : onRequestClose

  return (
    <DialogAny
      open={open}
      onOpenChange={handleOpenChange}
      dismissOnOverlayPress={!isFirstTime}
      disableEscapeKey={isFirstTime}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="overlay"
          transition="quick"
          opacity={0.5}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Dialog.Content
          key="content"
          aria-labelledby={TITLE_ID}
          animateOnly={['transform', 'opacity']}
          transition={reduceMotion ? '100ms' : 'designModal'}
          enterStyle={{ y: -10, opacity: 0 }}
          exitStyle={{ y: 10, opacity: 0 }}
          backgroundColor="$background"
          maxWidth={720}
          width="100%"
          padding="$5"
          gap="$4"
          borderWidth={1}
          borderColor="$color4"
        >
          {/* Heading */}
          <Dialog.Title
            id={TITLE_ID}
            fontFamily="$journal"
            fontSize="$6"
            color="$color12"
          >
            Posts are public
          </Dialog.Title>

          {/* Body copy — verbatim, regression-asserted in tests */}
          <Text
            fontFamily="$journal"
            fontSize="$4"
            color="$color"
          >
            {BODY_COPY}
          </Text>

          {/* "View community guidelines" link
              Tamagui Text does not expose `tag` in its TypeScript type, but it is a
              valid runtime prop on web. We use a TextAny alias (cast once, above) to
              suppress the typecheck error while keeping the correct semantic tag. */}
          <TextAny
            tag="a"
            accessibilityRole="link"
            fontFamily="$body"
            fontSize="$3"
            color="$stone"
            textDecorationLine="underline"
            cursor="pointer"
            onPress={onViewGuidelines}
            // onClick for web environments where onPress may not fire via click events
            onClick={onViewGuidelines}
          >
            View community guidelines
          </TextAny>

          {/* Acknowledge / close button */}
          <YStack marginTop="$4">
            <ExpandingLineButton
              size="cta"
              onPress={handleButtonPress}
              // id used for focus management via document.getElementById (web only;
              // RN deferred — see useEffect comment above)
              id={ACK_BUTTON_ID}
            >
              {buttonLabel}
            </ExpandingLineButton>
          </YStack>
        </Dialog.Content>
      </Dialog.Portal>
    </DialogAny>
  )
}
