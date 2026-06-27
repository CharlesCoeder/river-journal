// packages/app/features/collective/CollectiveAccessGate.tsx
//
// Boundary rule (D7): no Legend-State imports in this file. The auth + sync
// reads happen inside `useCollectiveAccess` (the permitted carve-out hook); this
// file only renders from the resolved status.
//
// The access gate that stands in front of the Collective FEED. Reading the room
// — even in sub-500 `preview` mode — requires an authenticated session AND cloud
// sync turned on, because the feed RPC's RLS policies enforce both. Without that
// guard the screen would just surface a bare "Couldn't load the feed." when the
// RLS check fails. Instead we catch the two upstream states and show the unified
// CollectiveLockedScreen, choosing the gate that matches the missing key:
//
//   - unauthenticated → gate='account'  ("Create an account")
//   - sync-disabled   → gate='sync'     ("Enable sync")
//
// The third gate state — gate='words' (signed in + synced, under the daily word
// goal) — is server-driven and rendered from CollectiveFeedScreen's preview
// branch, not here (we can't know it until the feed RPC returns mode:'preview').
//
// When access is granted we render the real feed (which then decides preview vs
// full on its own). While auth is still resolving we show the feed's own
// skeleton so the hand-off is seamless.

import { useState } from 'react'
import { YStack, View, useReducedMotion } from '@my/ui'
import { useRouter } from 'solito/navigation'
import CollectiveFeedScreen from 'app/features/collective/CollectiveFeedScreen'
import { useCollectiveAccess } from './useCollectiveAccess'
import { isCollectiveDevEnabled } from './isCollectiveDevEnabled'
import {
  CollectiveLockedScreen,
  SAMPLE_GLIMPSE,
  type CollectiveGateKey,
} from './CollectiveLockedScreen'
import { SkeletonRows } from './_shared'

// ─── Dev-only gate override ───────────────────────────────────────────────────
//
// DEV/DEMO ONLY. A render-time presentation override so each gate state is
// reachable for screenshots and demos without real credentials (a fresh
// agent-browser session is logged out and can only ever hit the 'account' gate).
//
// Driven by a URL query param on the /collective/dev route:
//     /collective/dev?gate=account
//     /collective/dev?gate=sync
//     /collective/dev?gate=words
//
// This introduces NO new global/store state and does NOT touch the real gate
// decision logic. It is a complete no-op when `isCollectiveDevEnabled()` is
// false (production auto-builds). The param is read once at render; the DemoPanel
// toggles then flip between states locally, mirroring the design's DemoPanel.

function readGateParam(): CollectiveGateKey | null {
  // `window` exists on React Native (it's the global object) but `window.location`
  // does not — so guarding only `typeof window` would throw on native. The URL
  // param override is a web-only affordance; native has no query string to read.
  if (typeof window === 'undefined' || !window.location) return null
  const v = new URLSearchParams(window.location.search).get('gate')
  return v === 'account' || v === 'sync' || v === 'words' ? v : null
}

function DevGateOverride({
  initialGate,
  onReturnHome,
  onSignIn,
  onEnableSync,
  onStartWriting,
}: {
  initialGate: CollectiveGateKey
  onReturnHome: () => void
  onSignIn: () => void
  onEnableSync: () => void
  onStartWriting: () => void
}) {
  // Local, render-time only (NOT persisted, NOT global). Mirrors the design's
  // App.tsx demo booleans; the derived gate matches the design's selection.
  const [signedIn, setSignedIn] = useState(initialGate !== 'account')
  const [syncEnabled, setSyncEnabled] = useState(initialGate === 'words')

  const gate: CollectiveGateKey = !signedIn ? 'account' : !syncEnabled ? 'sync' : 'words'

  return (
    <View flex={1} data-testid={`collective-access-dev-${gate}`}>
      <CollectiveLockedScreen
        gate={gate}
        // Illustrative partial progress for the words-state screenshot.
        wordsToday={320}
        glimpse={[...SAMPLE_GLIMPSE]}
        onReturnHome={onReturnHome}
        onSignIn={onSignIn}
        onEnableSync={onEnableSync}
        onStartWriting={onStartWriting}
        demo={{
          signedIn,
          syncEnabled,
          onToggleSignedIn: (v) => {
            setSignedIn(v)
            // Sync requires an account — drop it when signing out.
            if (!v) setSyncEnabled(false)
          },
          onToggleSync: setSyncEnabled,
        }}
      />
    </View>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CollectiveAccessGate() {
  const { status } = useCollectiveAccess()
  const router = useRouter()
  const reducedMotion = useReducedMotion()

  // Shared action wiring (see routing decision in the task brief).
  const onReturnHome = () => router.push('/')
  const onSignIn = () => router.push('/auth')
  const onEnableSync = () => router.push('/settings')
  const onStartWriting = () => router.push('/')

  // ─── Dev/demo override (no-op unless the flag is on AND ?gate= is present) ──
  const devGate = isCollectiveDevEnabled() ? readGateParam() : null
  if (devGate) {
    return (
      <DevGateOverride
        initialGate={devGate}
        onReturnHome={onReturnHome}
        onSignIn={onSignIn}
        onEnableSync={onEnableSync}
        onStartWriting={onStartWriting}
      />
    )
  }

  // ─── loading: auth still resolving — match the feed's own skeleton ────────
  if (status === 'loading') {
    return (
      <YStack
        maxWidth={720}
        width="100%"
        marginHorizontal="auto"
        paddingHorizontal="$5"
        paddingVertical="$8"
        data-testid="collective-access-loading"
      >
        <SkeletonRows reducedMotion={reducedMotion} />
      </YStack>
    )
  }

  // ─── unauthenticated: the account gate ────────────────────────────────────
  if (status === 'unauthenticated') {
    return (
      <View flex={1} data-testid="collective-access-unauthenticated">
        <CollectiveLockedScreen
          gate="account"
          glimpse={[...SAMPLE_GLIMPSE]}
          onReturnHome={onReturnHome}
          onSignIn={onSignIn}
          onEnableSync={onEnableSync}
          onStartWriting={onStartWriting}
        />
      </View>
    )
  }

  // ─── sync-disabled: the sync gate ─────────────────────────────────────────
  if (status === 'sync-disabled') {
    return (
      <View flex={1} data-testid="collective-access-sync-disabled">
        <CollectiveLockedScreen
          gate="sync"
          glimpse={[...SAMPLE_GLIMPSE]}
          onReturnHome={onReturnHome}
          onSignIn={onSignIn}
          onEnableSync={onEnableSync}
          onStartWriting={onStartWriting}
        />
      </View>
    )
  }

  // ─── granted: hand off to the real feed (it decides preview vs full) ──────
  return <CollectiveFeedScreen />
}

export default CollectiveAccessGate
