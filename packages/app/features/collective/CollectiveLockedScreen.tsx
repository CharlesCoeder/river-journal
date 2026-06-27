// packages/app/features/collective/CollectiveLockedScreen.tsx
//
// Boundary rule (D7): no Legend-State imports in this file. All sync/auth reads
// stay in the hooks (useCollectiveAccess); this screen renders purely from the
// resolved `gate` prop its callers pass in.
//
// The unified Collective locked screen — a single component that renders the
// three gate states, mirroring the design reference's `CollectiveLocked`
// (one component, a `gate` prop). It is an invitation, never a nag: three quiet
// keys open the room — an account, a synced journal, and today's words — and the
// gate shows only the one still missing while keeping the whole path in view.
//
// It is rendered from BOTH:
//   - CollectiveAccessGate, for gate='account' and gate='sync' (the two states
//     known immediately client-side), and
//   - CollectiveFeedScreen's preview branch, for gate='words' (the server-driven
//     sub-500 state, with the real preview posts for the glimpse).
//
// This absorbs the former CollectivePreview.tsx.

import { useEffect, useRef, useState } from 'react'
import { YStack, XStack, View, Text, ScrollView, useReducedMotion } from '@my/ui'
import {
  Lock,
  ArrowLeft,
  ArrowRight,
  Check,
  UserCircle,
  CloudUpload,
  PenLine,
} from '@tamagui/lucide-icons'
import type { Post } from 'app/state/collective/feed'
import { timeAgoCasual } from './_shared'

export type CollectiveGateKey = 'account' | 'sync' | 'words'

// ─── Glimpse data ─────────────────────────────────────────────────────────────
// A unified shape for the "glimpse inside" rows. Real preview posts (the `words`
// state from the feed) and the illustrative samples (the `account`/`sync` states,
// where the real feed RPC can't be called for a gated visitor) both collapse to
// this.

export interface GlimpseItem {
  id: string
  title: string
  sub: string
}

// Illustrative sample letters for the gated states (account/sync) and the dev
// `?gate=` override, where no real feed posts are available. NOT real data.
export const SAMPLE_GLIMPSE: readonly GlimpseItem[] = [
  {
    id: 'sample-1',
    title: 'On finishing things I never meant to start',
    sub: 'a member · 2h ago · 4 replies',
  },
  {
    id: 'sample-2',
    title: 'A letter to the version of me from this morning',
    sub: 'a member · 5h ago · 7 replies',
  },
  {
    id: 'sample-3',
    title: 'What the quiet taught me this week',
    sub: 'a member · yesterday · 12 replies',
  },
] as const

/** Build glimpse rows from real preview posts (the `words` state). */
export function glimpseFromPosts(posts: Post[]): GlimpseItem[] {
  return posts.slice(0, 3).map((p) => {
    const replies = p.descendant_count ?? 0
    return {
      id: p.id,
      title: p.title ?? 'Untitled',
      sub: `${timeAgoCasual(p.created_at)} · ${replies} ${replies === 1 ? 'reply' : 'replies'}`,
    }
  })
}

// ─── The daily word goal ──────────────────────────────────────────────────────
// Mirrors COLLECTIVE_GOAL in the design and the 500-word streak threshold.
export const COLLECTIVE_WORD_GOAL = 500

// ─── The living count (hard-coded; NOT real data) ─────────────────────────────
//
// IMPORTANT: This is a PLACEHOLDER, not real data. The community pulse (writers
// today / words today) is illustrative only — it is deliberately NOT wired to any
// backend, query, or app state. We are not building the sync/aggregation behind
// it. It seeds example values and fakes small upward increments on an interval,
// exactly like the design reference does. When the real aggregation ships, swap
// these seeds for a live source.

const PULSE_SEED_WRITERS = 2481
const PULSE_SEED_WORDS = 1243902

function CollectivePulse({ reducedMotion }: { reducedMotion: boolean }) {
  const [writers, setWriters] = useState(PULSE_SEED_WRITERS)
  const [words, setWords] = useState(PULSE_SEED_WORDS)

  // A gentle, irregular pulse so the numbers feel alive rather than scripted.
  // Suppressed entirely under reduced motion (no counter animation, no ticking).
  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => {
      setWriters((w) => w + (Math.random() < 0.35 ? 1 : 0))
      setWords((n) => n + Math.floor(9 + Math.random() * 31))
    }, 2400)
    return () => clearInterval(id)
  }, [reducedMotion])

  return (
    <YStack marginTop="$6" width="100%">
      <XStack alignItems="center" gap="$2">
        <PulseDot reducedMotion={reducedMotion} />
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color5"
          textTransform="uppercase"
          letterSpacing={1.1}
        >
          Writing together, today
        </Text>
      </XStack>

      <XStack marginTop="$4" alignItems="stretch" gap="$8">
        <PulseStat value={writers} label="writers today" reducedMotion={reducedMotion} />
        <View width={1} backgroundColor="$color2" />
        <PulseStat value={words} label="words today" reducedMotion={reducedMotion} />
      </XStack>
    </YStack>
  )
}

// A solid dot with a slow expanding/fading ring behind it. The ring is a quiet
// "ping" — suppressed under reduced motion (no infinite animation).
function PulseDot({ reducedMotion }: { reducedMotion: boolean }) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => setExpanded((v) => !v), 1100)
    return () => clearInterval(id)
  }, [reducedMotion])

  return (
    <View width={6} height={6} alignItems="center" justifyContent="center">
      {reducedMotion ? null : (
        <View
          position="absolute"
          width={6}
          height={6}
          borderRadius={100}
          backgroundColor="$color12"
          opacity={expanded ? 0 : 0.4}
          scale={expanded ? 2.6 : 1}
          animation="slow"
        />
      )}
      <View width={6} height={6} borderRadius={100} backgroundColor="$color12" />
    </View>
  )
}

function PulseStat({
  value,
  label,
  reducedMotion,
}: {
  value: number
  label: string
  reducedMotion: boolean
}) {
  const display = useCountUp(value, reducedMotion)
  return (
    <YStack gap="$2">
      <Text
        fontFamily="$journal"
        // Design: serif text-4xl / leading-none (36 / 36) — was $9 (30).
        fontSize={36}
        lineHeight={40}
        color="$color12"
      >
        {display.toLocaleString('en-US')}
      </Text>
      <Text
        fontFamily="$body"
        fontSize="$2"
        color="$color7"
        textTransform="uppercase"
        letterSpacing={1.1}
      >
        {label}
      </Text>
    </YStack>
  )
}

// Smoothly counts from the previous value to the next whenever the target moves.
// Under reduced motion it snaps straight to the target (no tween). The seed value
// renders immediately (displayed === target on mount), so nothing animates until
// the pulse interval nudges the target.
function useCountUp(target: number, reducedMotion: boolean): number {
  const [display, setDisplay] = useState(target)
  const rafRef = useRef<number | null>(null)
  const fromRef = useRef(target)

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
    const duration = 1200
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration)
      // easeOutExpo-ish — matches the design's settle.
      const eased = elapsed === 1 ? 1 : 1 - Math.pow(2, -10 * elapsed)
      const next = Math.round(from + (target - from) * eased)
      setDisplay(next)
      if (elapsed < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, reducedMotion])

  return display
}

// ─── The three-key path ───────────────────────────────────────────────────────

interface StepDef {
  key: CollectiveGateKey
  label: string
  Icon: typeof UserCircle
  done: boolean
}

function Stepper({ steps, current }: { steps: StepDef[]; current: CollectiveGateKey }) {
  return (
    <XStack alignItems="center" gap="$3" marginTop="$6" flexWrap="wrap">
      {steps.map((step, i) => {
        const active = step.key === current
        return (
          <XStack key={step.key} alignItems="center" gap="$3">
            <XStack alignItems="center" gap="$2">
              <View
                width={28}
                height={28}
                borderRadius={100}
                borderWidth={1}
                alignItems="center"
                justifyContent="center"
                borderColor={step.done ? '$color12' : active ? '$color12' : '$color3'}
                backgroundColor={step.done ? '$color12' : 'transparent'}
              >
                {step.done ? (
                  <Check size={14} color="$color1" />
                ) : (
                  <step.Icon size={15} color={active ? '$color12' : '$color4'} />
                )}
              </View>
              <Text
                fontFamily="$body"
                fontSize="$2"
                textTransform="uppercase"
                letterSpacing={1.1}
                color={step.done ? '$color7' : active ? '$color12' : '$color4'}
              >
                {step.label}
              </Text>
            </XStack>
            {i < steps.length - 1 ? (
              <View height={1} width={24} backgroundColor={step.done ? '$color6' : '$color3'} />
            ) : null}
          </XStack>
        )
      })}
    </XStack>
  )
}

// ─── The forward door (primary action) ────────────────────────────────────────

function PrimaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View
      role="button"
      aria-label={label}
      onPress={onPress}
      cursor="pointer"
      marginTop="$8"
      alignSelf="flex-start"
    >
      <XStack alignItems="center" gap="$3">
        <Text
          fontFamily="$journalItalic"
          fontStyle="italic"
          // Design: italic serif text-3xl (30) — was $8 (22), too small.
          fontSize="$9"
          color="$color12"
        >
          {label}
        </Text>
        <ArrowRight size={22} color="$color12" />
      </XStack>
    </View>
  )
}

// ─── Per-state content ────────────────────────────────────────────────────────

function GateHeadline({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$journal"
      // Design: text-5xl / leading-tight / tracking-tight (48 / 60 / -1.2).
      // No size token lands on 48, so these are explicit to match the reference.
      fontSize={48}
      lineHeight={60}
      letterSpacing={-1.2}
      color="$color12"
      marginTop="$7"
    >
      {children}
    </Text>
  )
}

function GateBody({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$journal"
      // Design: serif text-xl / leading-relaxed in stone (20 / 32.5 / color7).
      fontSize="$7"
      lineHeight={32}
      color="$color7"
      marginTop="$5"
    >
      {children}
    </Text>
  )
}

function AccountGate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <>
      <GateHeadline>A room full of people who wrote today.</GateHeadline>
      <GateBody>
        The Collective is everyone keeping a daily writing practice, gathered in one place. Joining
        begins with an account — your name among them, your words kept yours.
      </GateBody>
      <PrimaryAction label="Create an account" onPress={onSignIn} />
      <View
        role="button"
        aria-label="Already have one? Log in"
        onPress={onSignIn}
        cursor="pointer"
        marginTop="$4.5"
        alignSelf="flex-start"
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color7"
          textTransform="uppercase"
          letterSpacing={1.2}
        >
          Already have one? Log in
        </Text>
      </View>
    </>
  )
}

function SyncGate({ onEnableSync }: { onEnableSync: () => void }) {
  return (
    <>
      <GateHeadline>One last door — your letters, carried with you.</GateHeadline>
      <GateBody>
        The Collective gathers everyone's words across every device they write from, so it asks for
        a synced journal. Yours lift out of this one browser — backed up, and waiting wherever you
        open next. Turn on sync to take your place in the count.
      </GateBody>
      <PrimaryAction label="Enable sync" onPress={onEnableSync} />
      <Text fontFamily="$body" fontSize="$3" color="$color5" marginTop="$4.5" maxWidth={420}>
        You choose how it's encrypted — including end-to-end, where only you hold the key.
      </Text>
    </>
  )
}

function WordsGate({
  wordsToday,
  goal,
  onStartWriting,
  reducedMotion,
}: {
  wordsToday: number
  goal: number
  onStartWriting: () => void
  reducedMotion: boolean
}) {
  const remaining = Math.max(0, goal - wordsToday)
  const pct = Math.min(100, Math.round((wordsToday / goal) * 100))

  return (
    <>
      <GateHeadline>A quiet room, just through here.</GateHeadline>
      <GateBody>
        {`Write ${goal} words of your own today, and join us in the Collective. There's a quiet joy in coming into tune with yourself on the page — and a rarer one in sharing that hour with others of like mind.`}
      </GateBody>

      {/* The live per-user count, drifting toward the threshold */}
      <YStack width="100%" marginTop="$8" gap="$3">
        <XStack justifyContent="space-between" alignItems="baseline">
          <Text fontFamily="$body" fontSize="$4" color="$color12">
            {wordsToday}
            <Text color="$color7">{` / ${goal} words today`}</Text>
          </Text>
          <Text
            fontFamily="$body"
            fontSize="$3"
            color="$color5"
            textTransform="uppercase"
            letterSpacing={1.2}
          >
            {remaining === 0 ? 'Ready' : `${remaining} to go`}
          </Text>
        </XStack>
        <View
          height={1}
          width="100%"
          backgroundColor="$color3"
          position="relative"
          overflow="hidden"
        >
          <View
            position="absolute"
            top={0}
            bottom={0}
            left={0}
            width={`${pct}%`}
            backgroundColor="$color12"
            animation={reducedMotion ? undefined : 'slow'}
          />
        </View>
      </YStack>

      <PrimaryAction
        label={wordsToday > 0 ? 'Keep writing' : 'Begin writing'}
        onPress={onStartWriting}
      />
    </>
  )
}

// ─── The glimpse ──────────────────────────────────────────────────────────────

function RoomGlimpse({ glimpse }: { glimpse: GlimpseItem[] }) {
  if (glimpse.length === 0) return null
  return (
    <YStack marginTop="$12" gap="$6" aria-hidden>
      <Text
        fontFamily="$body"
        // Design: stone/50 — softer than the body's stone, the faintest label
        // on the screen. Was $color8 (darker than stone), which read too heavy.
        fontSize="$3"
        color="$color4"
        textTransform="uppercase"
        letterSpacing={1.2}
      >
        A glimpse inside
      </Text>
      <View position="relative">
        <YStack
          gap="$7"
          opacity={0.4}
          pointerEvents="none"
          // Web-only soft veil; native ignores `filter` (acceptable divergence,
          // mirrors the prior CollectivePreview).
          style={{ filter: 'blur(1.5px)' }}
        >
          {glimpse.map((item) => (
            <YStack key={item.id} gap="$2">
              <Text
                fontFamily="$journal"
                // Design: serif text-2xl / leading-snug (24 / 33).
                fontSize={24}
                lineHeight={33}
                color="$color12"
              >
                {item.title}
              </Text>
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$color7"
                textTransform="uppercase"
                letterSpacing={1}
              >
                {item.sub}
              </Text>
            </YStack>
          ))}
        </YStack>
      </View>
    </YStack>
  )
}

// ─── Demo panel (dev/demo only) ───────────────────────────────────────────────
// Mirrors the design reference's DemoPanel: toggles to flip signedIn/syncEnabled
// while demoing. Rendered ONLY when `demo` callbacks are supplied — i.e. from
// CollectiveAccessGate's dev override path, never in the real gated flow. Drives
// purely render-time local state in the caller; introduces no global/store state.

export interface DemoControls {
  signedIn: boolean
  syncEnabled: boolean
  onToggleSignedIn: (value: boolean) => void
  onToggleSync: (value: boolean) => void
}

function DemoPanel({ demo }: { demo: DemoControls }) {
  return (
    <YStack
      marginTop="$11"
      paddingTop="$5"
      borderTopWidth={1}
      borderTopColor="$color2"
      maxWidth={420}
      width="100%"
      gap="$4"
    >
      <Text
        fontFamily="$body"
        fontSize="$2"
        color="$color4"
        textTransform="uppercase"
        letterSpacing={1.1}
      >
        Demo · preview states
      </Text>
      <DemoToggle label="Signed in" checked={demo.signedIn} onChange={demo.onToggleSignedIn} />
      <DemoToggle
        label="Sync enabled"
        checked={demo.syncEnabled}
        disabled={!demo.signedIn}
        onChange={demo.onToggleSync}
      />
    </YStack>
  )
}

function DemoToggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <View
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onPress={disabled ? undefined : () => onChange(!checked)}
      cursor={disabled ? 'default' : 'pointer'}
      opacity={disabled ? 0.4 : 1}
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$4">
        <Text fontFamily="$body" fontSize="$4" color="$color12">
          {label}
        </Text>
        <View
          width={40}
          height={20}
          borderRadius={100}
          backgroundColor={checked ? '$color12' : '$color3'}
          justifyContent="center"
        >
          <View
            position="absolute"
            width={16}
            height={16}
            borderRadius={100}
            backgroundColor="$color1"
            left={checked ? 22 : 2}
            animation="quick"
          />
        </View>
      </XStack>
    </View>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

export interface CollectiveLockedScreenProps {
  /** Which gate to render. Driven by the caller (account/sync from
   *  useCollectiveAccess; words from the feed preview / dev override). */
  gate: CollectiveGateKey
  /** Today's per-user word count for the `words` state's progress bar. */
  wordsToday?: number
  /** The daily word goal (defaults to COLLECTIVE_WORD_GOAL). */
  goal?: number
  /** Rows for the "glimpse inside" — real preview posts or sample letters. */
  glimpse?: GlimpseItem[]
  onReturnHome: () => void
  onSignIn: () => void
  onEnableSync: () => void
  onStartWriting: () => void
  /** When supplied, renders the dev-only DemoPanel. Omit in the real flow. */
  demo?: DemoControls
}

export function CollectiveLockedScreen({
  gate,
  wordsToday = 0,
  goal = COLLECTIVE_WORD_GOAL,
  glimpse = [],
  onReturnHome,
  onSignIn,
  onEnableSync,
  onStartWriting,
  demo,
}: CollectiveLockedScreenProps) {
  const reducedMotion = useReducedMotion()

  // The three keys. Each is `done` once earned, `active` when it is the current
  // gate, and `pending` otherwise — derived from the gate the caller resolved.
  const steps: StepDef[] = [
    {
      key: 'account',
      label: 'An account',
      Icon: UserCircle,
      done: gate !== 'account',
    },
    {
      key: 'sync',
      label: 'Sync on',
      Icon: CloudUpload,
      done: gate === 'words',
    },
    {
      key: 'words',
      label: "Today's words",
      Icon: PenLine,
      done: gate === 'words' && wordsToday >= goal,
    },
  ]

  return (
    // The screen owns its own scroll. On native there is no ambient scroll
    // container around routed screens, so without this the tall locked-screen
    // content (pulse + stepper + gate copy + glimpse) overflows the viewport
    // with no way to reach the primary action below the fold. Mirrors the
    // Settings screen's flex + ScrollView wrapper.
    <View flex={1} backgroundColor="$background">
      <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
        {/* NOTE: no root `enterStyle` entrance fade here. With the motion
            animation driver, an `enterStyle` opacity/translate needs an
            <AnimatePresence> ancestor to animate out of the enter state;
            without one the container stays stuck at opacity 0 (invisible
            content). The smaller in-place animations below (the pulse ring, the
            progress bar, the demo toggle) are driven by state changes, not
            enterStyle, so they animate fine. */}
        <YStack
          width="100%"
          maxWidth={720}
          marginHorizontal="auto"
          paddingHorizontal="$5"
          paddingVertical="$8"
          paddingBottom="$12"
        >
          {/* Back to Home */}
          <View
            role="button"
            aria-label="Back to Home"
            onPress={onReturnHome}
            cursor="pointer"
            alignSelf="flex-start"
            marginBottom="$10"
          >
            <XStack alignItems="center" gap="$2">
              <ArrowLeft size={16} color="$color7" />
              <Text fontFamily="$body" fontSize="$4" color="$color7" letterSpacing={1}>
                Back to Home
              </Text>
            </XStack>
          </View>

          {/* The invitation */}
          <YStack maxWidth={520} alignItems="flex-start">
            {/* Eyebrow */}
            <XStack alignItems="center" gap="$2">
              <Lock size={14} color="$color7" />
              <Text
                fontFamily="$body"
                fontSize="$3"
                color="$color7"
                textTransform="uppercase"
                letterSpacing={1.2}
              >
                The Collective
              </Text>
            </XStack>

            {/* The living proof — hard-coded, NOT real data (see CollectivePulse). */}
            <CollectivePulse reducedMotion={reducedMotion} />

            {/* The three keys — only the missing one glows. */}
            <Stepper steps={steps} current={gate} />

            {gate === 'account' ? <AccountGate onSignIn={onSignIn} /> : null}
            {gate === 'sync' ? <SyncGate onEnableSync={onEnableSync} /> : null}
            {gate === 'words' ? (
              <WordsGate
                wordsToday={wordsToday}
                goal={goal}
                onStartWriting={onStartWriting}
                reducedMotion={reducedMotion}
              />
            ) : null}
          </YStack>

          {/* A glimpse of the room, behind the glass */}
          <RoomGlimpse glimpse={glimpse} />

          {/* Dev/demo only — flip between gate states. */}
          {demo ? <DemoPanel demo={demo} /> : null}
        </YStack>
      </ScrollView>
    </View>
  )
}

export default CollectiveLockedScreen
