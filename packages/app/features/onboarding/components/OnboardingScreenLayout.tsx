import type { ReactNode } from 'react'
import { Text, View } from '@tamagui/tailwind'

// ---------------------------------------------------------------------------
// OnboardingScreenLayout — the single full-screen shape shared by all three
// onboarding sub-screens (Practice / Community / Progression).
//
// Typography carries the screens: a Newsreader serif headline in the date-hero
// register (fontFamily="journal") over a small Outfit sans body. No imagery,
// no icons — just calm type and generous whitespace.
//
// This layout is also the animated element for the sequence: it owns the
// `transition` / `enter:` values so each screen springs in when it mounts. The
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
    <View
      render="section"
      aria-labelledby={headlineId}
      // Works at runtime, but Tailwind components leave transition out of their types.
      {...({ transition } as object)}
      className="flex-1 w-full max-w-[1024px] self-center justify-center items-start bg-background px-4 sm:px-6 md:px-8 lg:px-12 opacity-100 enter:opacity-0 translate-y-0 enter:translate-y-[15px]"
    >
      <View className="gap-5 w-full">
        <Text
          render="h1"
          id={headlineId}
          tabIndex={-1}
          className="web:font-normal font-journal text-[22px] sm:text-[20px] text-color tracking-[-1px]"
        >
          {headline}
        </Text>
        <Text className="font-body text-[14px] text-color8 tracking-[0.5px] max-w-[520px]">{body}</Text>
      </View>

      {/*
        Reserved illustration region. Intentionally empty at MVP — it holds a
        fixed vertical slot between the headline block and the CTA row so an
        illustration can slot in later without re-shaping (re-flowing) the
        screen. Do NOT collapse this; it exists to keep the layout stable.
      */}
      <View className="min-h-[160px] w-full" />

      {children}
    </View>
  )
}

// ---------------------------------------------------------------------------
// OnboardingSkipButton — the Secondary quiet affordance ("Skip" by default,
// or another quiet label such as "Not now").
//
// Per the UX Button Hierarchy, the secondary is NOT the primary CTA and NOT
// an ExpandingLineButton): a small sans label with a thin static 1px bottom
// border and a muted stone color, with no expand-on-press motion. Only one
// primary action per screen; the secondary is always the quiet exit beside it.
// ---------------------------------------------------------------------------

export interface OnboardingSkipButtonProps {
  onPress: () => void
  /** Quiet secondary label. Defaults to "Skip"; the consent screen uses "Not now". */
  label?: string
}

export function OnboardingSkipButton({ onPress, label = 'Skip' }: OnboardingSkipButtonProps) {
  return (
    <Text
      render="button"
      aria-label={label}
      onPress={onPress}
      className="font-body text-[14px] hover:text-color tracking-[0.5px] border-b border-b-color6 cursor-pointer press:opacity-60"
    >
      {label}
    </Text>
  )
}
