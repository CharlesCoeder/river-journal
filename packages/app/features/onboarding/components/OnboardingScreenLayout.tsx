import type { ReactNode } from 'react'
import { Text, View, YStack } from '@my/ui'

// ---------------------------------------------------------------------------
// OnboardingScreenLayout — the single full-screen shape shared by all three
// onboarding sub-screens (Practice / Community / Progression).
//
// Typography carries the screens: a Newsreader serif headline in the date-hero
// register (fontFamily="$journal") over a small Outfit sans body. No imagery,
// no icons — just calm type and generous whitespace.
//
// This layout is also the animated element for the sequence: it owns the
// `transition` / `enterStyle` so each screen springs in when it mounts. The
// container swaps which screen renders (one at a time) and AnimatePresence
// drives the enter/exit.
// ---------------------------------------------------------------------------

export interface OnboardingScreenLayoutProps {
  /** DOM id assigned to the headline so the container can move focus to it. */
  headlineId: string
  /** Serif headline copy (date-hero register). */
  headline: string
  /** Small sans body copy explaining the screen. */
  body: string
  /** Animation token: 'designEnterSlow' normally, '100ms' under reduced motion. */
  transition: string
  /** CTA row (primary action + Skip) rendered below the reserved region. */
  children: ReactNode
}

export function OnboardingScreenLayout({
  headlineId,
  headline,
  body,
  transition,
  children,
}: OnboardingScreenLayoutProps) {
  return (
    <YStack
      tag="section"
      aria-labelledby={headlineId}
      transition={transition}
      enterStyle={{ opacity: 0, y: 15 }}
      opacity={1}
      y={0}
      flex={1}
      backgroundColor="$background"
      width="100%"
      maxWidth={1024}
      alignSelf="center"
      justifyContent="center"
      alignItems="flex-start"
      paddingHorizontal="$4"
      $sm={{ paddingHorizontal: '$6' }}
      $md={{ paddingHorizontal: '$8' }}
      $lg={{ paddingHorizontal: '$12' }}
    >
      <YStack
        gap="$5"
        width="100%"
      >
        <Text
          tag="h1"
          id={headlineId}
          // tabIndex={-1} makes the headline programmatically focusable so the
          // container can move focus here on each transition (screen-reader nav).
          tabIndex={-1}
          fontFamily="$journal"
          fontSize="$8"
          color="$color"
          letterSpacing={-1}
          $sm={{ fontSize: '$7' }}
        >
          {headline}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color8"
          letterSpacing={0.5}
          maxWidth={520}
        >
          {body}
        </Text>
      </YStack>

      {/*
        Reserved illustration region. Intentionally empty at MVP — it holds a
        fixed vertical slot between the headline block and the CTA row so an
        illustration can slot in later without re-shaping (re-flowing) the
        screen. Do NOT collapse this; it exists to keep the layout stable.
      */}
      <View
        minHeight={160}
        width="100%"
      />

      {children}
    </YStack>
  )
}

// ---------------------------------------------------------------------------
// OnboardingSkipButton — the Secondary "Skip" affordance.
//
// Per the UX Button Hierarchy, Skip is Secondary (NOT the primary CTA and NOT
// an ExpandingLineButton): a small sans label with a thin static 1px bottom
// border and a muted stone color, with no expand-on-press motion. Only one
// primary action per screen; Skip is always the quiet exit beside it.
// ---------------------------------------------------------------------------

export interface OnboardingSkipButtonProps {
  onPress: () => void
}

export function OnboardingSkipButton({ onPress }: OnboardingSkipButtonProps) {
  return (
    <Text
      tag="button"
      accessibilityLabel="Skip"
      onPress={onPress}
      fontFamily="$body"
      fontSize="$4"
      color="$stone"
      letterSpacing={0.5}
      borderBottomWidth={1}
      borderBottomColor="$color6"
      cursor="pointer"
      hoverStyle={{ color: '$color' }}
      pressStyle={{ opacity: 0.6 }}
    >
      Skip
    </Text>
  )
}
