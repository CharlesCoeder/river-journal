// @vitest-environment happy-dom
/**
 * `OnboardingGate` (first-launch gating + skippable-flow completion
 * persistence, wrapping `OnboardingSequence`)
 *
 * E2E test covering:
 *   - first-launch gating: no flag -> OnboardingSequence renders instead of
 *     the home child (HomeScreen stands in for a sentinel here)
 *   - lapsed-prompt exclusion for brand-new users (both: useLapsedPrompt
 *     returns shouldShow=false for a brand-new user, AND the home child
 *     that would host LapsedPrompt never mounts while onboarding shows)
 *   - Get started writes onboardingCompletedAt to the persisted, local-only
 *     onboarding$ observable; gate then swaps to the home child
 *   - Skip sets the SAME flag (skip == completion); gate swaps to home child
 *   - flag already set -> home child renders directly, no onboarding flash
 *   - per-device semantics: gate behavior depends ONLY on the local
 *     onboarding$ flag, never on synced account state (syncUserId$)
 *   - mid-flow resume: persisted (and range-clamped) currentScreen is read
 *     once as OnboardingSequence's initialScreen; advancing screens writes
 *     back through setOnboardingScreen
 *
 * `OnboardingSequence` (packages/app/features/onboarding/) already exists —
 * this file does not modify it or its existing tests. `OnboardingGate`
 * mounts `OnboardingSequence` unmodified when no completion flag is present,
 * so this file's mocks mirror OnboardingSequence.test.tsx's skeleton exactly
 * (same @my/ui / solito/navigation stubs) so Screen 1-3 copy, roles, and
 * headlines resolve the same way here as in that suite.
 *
 * Mock strategy: @my/ui mocked to map Tamagui primitives to testable HTML
 * elements (copied from features/onboarding/__tests__/OnboardingSequence.test.tsx),
 * `solito/navigation` useRouter mocked with a spy. The "home" side of the gate
 * is a plain sentinel div — OnboardingGate takes `children` and does not import
 * HomeScreen itself (deep-import only, no packages/app/index.ts re-exports),
 * so a sentinel child is representative of the real wiring at
 * apps/web|desktop/app/page.tsx and apps/mobile/app/index.tsx.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — controllable mock state
// ─────────────────────────────────────────────────────────────────────────────
const { mockReducedMotion, mockRouterPush } = vi.hoisted(() => {
  return {
    mockReducedMotion: { current: false },
    mockRouterPush: vi.fn(),
  }
})

// ─── Mock solito/navigation — spy on router.push (used by OnboardingSequence) ──
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ─── Mock @my/ui — map Tamagui primitives to testable HTML elements ──────────
// Copied from OnboardingSequence.test.tsx so Screen 1-3 render identically here.
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapCommon = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props.id !== undefined) out.id = props.id
    if (props['aria-label'] !== undefined) out['aria-label'] = props['aria-label']
    if (props.accessibilityLabel !== undefined) out['aria-label'] = props.accessibilityLabel
    if (props['aria-labelledby'] !== undefined) out['aria-labelledby'] = props['aria-labelledby']
    if (props.role !== undefined) out.role = props.role
    if (props.accessibilityRole !== undefined) out.role = props.accessibilityRole
    if (props.tabIndex !== undefined) out.tabIndex = props.tabIndex
    if (props.testID !== undefined) out['data-testid'] = props.testID
    if (props['data-testid'] !== undefined) out['data-testid'] = props['data-testid']
    if (props.transition !== undefined) out['data-transition'] = String(props.transition)
    if (props.onPress) out.onClick = props.onPress
    return out
  }

  const Text = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'span'
    return ReactModule.createElement(htmlTag, mapCommon(props), children)
  }

  const View = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, mapCommon(props), children)
  }

  const YStack = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, { 'data-stack': 'y', ...mapCommon(props) }, children)
  }

  const XStack = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, { 'data-stack': 'x', ...mapCommon(props) }, children)
  }

  const AnimatePresence = ({ children }: any) => children

  const ExpandingLineButton = ({ children, onPress, disabled, accessibilityLabel, id }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        id,
        onClick: disabled ? undefined : onPress,
        disabled: !!disabled,
        'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
      },
      children
    )

  return {
    Text,
    View,
    YStack,
    XStack,
    AnimatePresence,
    ExpandingLineButton,
    useReducedMotion: () => mockReducedMotion.current,
  }
})

// ─── Import under test ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { OnboardingGate } from '../OnboardingGate'
// eslint-disable-next-line import/first
import { onboarding$ } from 'app/state/onboarding'
// eslint-disable-next-line import/first
import { lapsed$ } from 'app/state/lapsed'
// eslint-disable-next-line import/first
import { useLapsedPrompt } from '../../home/useLapsedPrompt'
// eslint-disable-next-line import/first
import { syncUserId$ } from 'app/state/syncConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const HOME_SENTINEL_TESTID = 'home-sentinel'

function HomeSentinel() {
  return React.createElement('div', { 'data-testid': HOME_SENTINEL_TESTID }, 'HOME SENTINEL')
}

function renderGate() {
  return render(React.createElement(OnboardingGate, null, React.createElement(HomeSentinel)))
}

function queryHomeSentinel(): HTMLElement | null {
  return screen.queryByTestId(HOME_SENTINEL_TESTID)
}

function queryOnboardingHeadline(): HTMLElement | null {
  return screen.queryByText(/Write 500 words a day/i)
}

/** Host component that surfaces useLapsedPrompt's shouldShow via a text node. */
function LapsedProbe({ now }: { now: number }) {
  const { shouldShow } = useLapsedPrompt(now)
  return React.createElement('div', { 'data-testid': 'lapsed-should-show' }, String(shouldShow))
}

const T0 = 1_700_000_000_000 // arbitrary fixed epoch ms, mirrors lapsed.test.ts convention

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReducedMotion.current = false
  mockRouterPush.mockClear()

  // Reset onboarding$ to initial shape before every test (no persistence involved).
  onboarding$.set({
    onboardingCompletedAt: null,
    currentScreen: 0,
  })

  // Reset lapsed$ to its brand-new-user initial shape (matches state/__tests__/lapsed.test.ts).
  lapsed$.set({
    lastSessionAt: null,
    previousSessionAt: null,
    dismissedAt: null,
    hasOpenedBefore: false,
  })

  // Reset synced-account state so the sync-independence tests control it explicitly.
  syncUserId$.set(null)
})

afterEach(() => {
  cleanup()
  syncUserId$.set(null)
})

// =============================================================================
// First-launch gating: no flag -> OnboardingSequence renders, not home
// =============================================================================

describe('first-launch gating (no onboardingCompletedAt)', () => {
  it('renders OnboardingSequence (Screen 1 headline) instead of the home child', () => {
    renderGate()
    expect(queryOnboardingHeadline()).not.toBeNull()
  })

  it('does NOT mount the home child while onboarding is showing', () => {
    renderGate()
    expect(queryHomeSentinel()).toBeNull()
  })

  it('applies on mount with no other state configured (default fresh-install shape)', () => {
    renderGate()
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeNull()
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeNull()
  })
})

// =============================================================================
// Lapsed-prompt exclusion for brand-new users
// =============================================================================

describe('lapsed prompt excluded for brand-new users', () => {
  it('useLapsedPrompt reports shouldShow=false for a brand-new user (no prior session)', () => {
    render(React.createElement(LapsedProbe, { now: T0 }))
    expect(screen.getByTestId('lapsed-should-show').textContent).toBe('false')
  })

  it('the home child (which would host LapsedPrompt) never mounts while onboarding renders', () => {
    renderGate()
    // If the home child isn't mounted at all, LapsedPrompt (which lives inside
    // HomeScreen) cannot possibly be visible either — the gate structurally
    // prevents the co-occurrence regardless of useLapsedPrompt's own gating.
    expect(queryHomeSentinel()).toBeNull()
    expect(queryOnboardingHeadline()).not.toBeNull()
  })
})

// =============================================================================
// Completion persistence on "Get started"
// =============================================================================

describe('Get started writes onboardingCompletedAt and swaps to home', () => {
  it('sets onboarding$.onboardingCompletedAt to a non-null ISO string', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // -> screen 2
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // -> screen 3
    fireEvent.click(screen.getByRole('button', { name: /get started/i }))

    const completedAt = onboarding$.onboardingCompletedAt.get()
    expect(typeof completedAt).toBe('string')
    expect(completedAt).not.toBeNull()
  })

  it('re-renders showing the home child once completed, onboarding no longer present', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /get started/i }))

    expect(queryHomeSentinel()).not.toBeNull()
    expect(queryOnboardingHeadline()).toBeNull()
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull()
  })
})

// =============================================================================
// Skip counts as completion (same flag as Get started)
// =============================================================================

describe('Skip sets the same completion flag as Get started', () => {
  it('Skip on Screen 1 sets onboarding$.onboardingCompletedAt to a non-null value', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))

    expect(onboarding$.onboardingCompletedAt.get()).not.toBeNull()
  })

  it('Skip swaps the gate to the home child, same as Get started does', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))

    expect(queryHomeSentinel()).not.toBeNull()
    expect(queryOnboardingHeadline()).toBeNull()
  })
})

// =============================================================================
// Return-user suppression: flag already set -> home directly, no flash
// =============================================================================

describe('flag already set renders home directly (no onboarding flash)', () => {
  it('renders the home child on first paint when onboardingCompletedAt is already set', () => {
    onboarding$.onboardingCompletedAt.set('2026-01-01T00:00:00.000Z')
    renderGate()

    expect(queryHomeSentinel()).not.toBeNull()
  })

  it('does NOT mount OnboardingSequence at all when the flag is already set', () => {
    onboarding$.onboardingCompletedAt.set('2026-01-01T00:00:00.000Z')
    renderGate()

    expect(queryOnboardingHeadline()).toBeNull()
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull()
  })
})

// =============================================================================
// Per-device semantics: gate depends only on the local flag, never sync
// =============================================================================

describe('per-device: gate ignores synced account state entirely', () => {
  it('still shows onboarding on a fresh device even when a synced account is present', () => {
    // Simulate "same account already completed onboarding on another device":
    // a synced user id is present, but THIS device's local onboarding$ flag is
    // untouched (default/null). Per-device semantics mean the gate must still
    // show onboarding — it never consults synced/account state.
    syncUserId$.set('user-completed-onboarding-elsewhere')
    renderGate()

    expect(queryOnboardingHeadline()).not.toBeNull()
    expect(queryHomeSentinel()).toBeNull()
  })

  it('still respects the local flag when a synced account is present and locally completed', () => {
    syncUserId$.set('user-completed-onboarding-elsewhere')
    onboarding$.onboardingCompletedAt.set('2026-01-01T00:00:00.000Z')
    renderGate()

    expect(queryHomeSentinel()).not.toBeNull()
    expect(queryOnboardingHeadline()).toBeNull()
  })
})

// =============================================================================
// Mid-flow resume via persisted, clamped currentScreen
// =============================================================================

describe('resumes mid-flow from the persisted currentScreen', () => {
  it('mounts directly on Screen 3 when currentScreen was persisted as 2', () => {
    onboarding$.currentScreen.set(2)
    renderGate()

    expect(screen.getByRole('button', { name: /get started/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull()
  })

  it('clamps an out-of-range persisted currentScreen (5) down to Screen 3, no crash', () => {
    onboarding$.currentScreen.set(5)
    expect(() => renderGate()).not.toThrow()

    expect(screen.getByRole('button', { name: /get started/i })).not.toBeNull()
  })

  it('advancing via Continue writes the new screen back to onboarding$.currentScreen', () => {
    renderGate()
    expect(onboarding$.currentScreen.get()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // -> screen 2
    expect(onboarding$.currentScreen.get()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // -> screen 3
    expect(onboarding$.currentScreen.get()).toBe(2)
  })

  it('once onboardingCompletedAt is set, a stale persisted currentScreen no longer matters', () => {
    onboarding$.currentScreen.set(1)
    onboarding$.onboardingCompletedAt.set('2026-01-01T00:00:00.000Z')
    renderGate()

    // Gate goes straight to home regardless of currentScreen once completed.
    expect(queryHomeSentinel()).not.toBeNull()
    expect(queryOnboardingHeadline()).toBeNull()
  })
})

// Guard against act() warnings leaking across tests in the single-threaded run.
afterEach(async () => {
  await act(async () => {})
})
