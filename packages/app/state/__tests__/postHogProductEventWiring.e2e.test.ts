// @vitest-environment happy-dom
/**
 * postHogProductEventWiring.e2e.test.ts — TDD RED-PHASE E2E spec for
 * "client-originated product events are wired through captureEvent".
 *
 * Two kinds of workflow are exercised here, matching what's actually
 * testable end-to-end without mounting a full navigation stack for seven
 * different screens:
 *
 *  1. `flow_500_crossed` — the ONE call site that is a plain exported
 *     function (`recordThresholdCrossingIfNeeded` in `state/store.ts`) —
 *     this is exercised for real: the real store, the real idempotent
 *     crossing logic, only the `telemetry/posthog` SDK-facing module
 *     mocked at the boundary (same convention as `store.editor.test.ts`
 *     mocking `../../utils/supabase`).
 *
 *  2. Every other call site (HomeScreen, JournalScreen, CelebrationScreen,
 *     the Collective post/reaction/report surfaces, and
 *     CancelSubscriptionFlow) lives inside a React component or a
 *     TanStack Query mutation callback with heavy provider/store
 *     dependencies. Mounting all seven is out of scope for this spec, so —
 *     mirroring this repo's existing convention for wiring/scaffolding checks
 *     (`depsAndConfig.e2e.test.ts`) — these are verified by reading the
 *     REAL source files an app build would ship and asserting the actual
 *     `captureEvent(...)` call exists at (or near) the documented trigger
 *     point. This is a real end-to-end check of the shipped wiring, not a
 *     mock.
 *
 * RED PHASE: none of these `captureEvent` call sites exist yet
 * (grep-confirmed zero `captureEvent` references anywhere in the repo
 * before this story). Every test below MUST fail until this story is
 * implemented.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../../..')

function readText(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

// ─── Mock Supabase + persistence so importing the real store.ts is safe ────
vi.mock('../../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

// ─── Mock the telemetry SDK-facing module at the boundary (the true I/O
// boundary for this workflow is PostHog, not our own validated helper —
// but per the story's own testing standard we assert against the exported
// `captureEvent` call, exactly like `setSentryUser` is asserted against in
// the existing auth wiring tests). ─────────────────────────────────────────
// vi.hoisted so the mock object is initialized before the hoisted vi.mock
// factory below references it (the factory runs as soon as store.ts imports the
// posthog module). A plain top-level const would trip vitest's hoisting rule.
const { captureEventMock } = vi.hoisted(() => ({ captureEventMock: vi.fn() }))
vi.mock('../../utils/telemetry/posthog', () => ({
  captureEvent: captureEventMock,
  initPostHog: vi.fn(),
  identifyPostHogUser: vi.fn(),
}))

import { store$, ephemeral$, recordThresholdCrossingIfNeeded } from '../store'

beforeEach(() => {
  captureEventMock.mockClear()
  store$.session.assign({ userId: 'user-500', email: null, isAuthenticated: true })
  store$.profile.set({ subscription_tier: 'paid_monthly' } as any)
  ephemeral$.thresholdCrossing.set(null)
})

afterEach(() => {
  store$.session.assign({ userId: null, email: null, isAuthenticated: false })
  store$.profile.set(null)
  ephemeral$.thresholdCrossing.set(null)
})

describe('recordThresholdCrossingIfNeeded — emits flow_500_crossed exactly once per active flow', () => {
  it('stays quiet under the threshold, emits with { user_id, tier } the instant it crosses 500, then never re-emits for the same flow', () => {
    // Under the threshold: no emission yet (pre-existing guard behavior).
    recordThresholdCrossingIfNeeded(499)
    expect(captureEventMock).not.toHaveBeenCalled()

    // Crossing: exactly one flow_500_crossed emission with the real
    // session/tier values read from the store.
    recordThresholdCrossingIfNeeded(500)
    expect(captureEventMock).toHaveBeenCalledTimes(1)
    const [event, props] = captureEventMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(event).toBe('flow_500_crossed')
    expect(props).toEqual({ user_id: 'user-500', tier: 'paid_monthly' })

    // Idempotent: further growth within the same active flow never re-emits.
    captureEventMock.mockClear()
    recordThresholdCrossingIfNeeded(750)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('flow_started — wired at the "Begin Writing" CTA', () => {
  it('HomeScreen.tsx calls captureEvent(\'flow_started\', ...) from handleBeginFlow', () => {
    const file = readText('packages/app/features/home/HomeScreen.tsx')
    expect(file).toContain("captureEvent('flow_started'")

    const handlerBody = file.slice(file.indexOf('const handleBeginFlow'), file.indexOf('const handleBeginFlow') + 400)
    expect(handlerBody).toContain('captureEvent(')
  })
})

describe('flow_completed — wired at the save-flow trigger, bucketed word count only', () => {
  it("JournalScreen.tsx calls captureEvent('flow_completed', ...) from handleSaveFlow, and never sends the raw word count", () => {
    const file = readText('packages/app/features/journal/JournalScreen.tsx')
    expect(file).toContain("captureEvent('flow_completed'")

    const handlerBody = file.slice(
      file.indexOf('const handleSaveFlow'),
      file.indexOf('const handleSaveFlow') + 600
    )
    expect(handlerBody).toContain('captureEvent(')

    // The raw wordCount value must never be forwarded directly as a prop —
    // only the bucketed string may leave this call site.
    expect(file).not.toMatch(/word_count\s*:\s*newFlow\.wordCount/)
    expect(file).not.toMatch(/wordCount\s*:\s*newFlow\.wordCount/)
  })
})

describe('streak_unlock_earned — wired at the celebration mount effect, includes milestone', () => {
  it("CelebrationScreen.tsx calls captureEvent('streak_unlock_earned', ...) alongside markUnlockSurfaced", () => {
    const file = readText('packages/app/features/journal/CelebrationScreen.tsx')
    expect(file).toContain("captureEvent('streak_unlock_earned'")

    const markIdx = file.indexOf('markUnlockSurfaced(latestEarnedMilestone)')
    expect(markIdx).toBeGreaterThan(-1)
    const nearby = file.slice(Math.max(0, markIdx - 300), markIdx + 300)
    expect(nearby).toContain('captureEvent(')
  })
})

describe('collective_post_submitted — wired after a confirmed post creation', () => {
  it("PostComposer.tsx or the ['collective','post'] mutation calls captureEvent('collective_post_submitted', ...)", () => {
    const composer = readText('packages/app/features/collective/PostComposer.tsx')
    const mutations = readText('packages/app/state/collective/mutations.ts')
    const combined = composer + mutations
    expect(combined).toContain("captureEvent('collective_post_submitted'")
  })
})

describe('collective_reaction_toggled — wired at the reaction toggle, includes reaction_kind', () => {
  it("ReactionStrip.tsx or the ['collective','react'] mutation calls captureEvent('collective_reaction_toggled', ...)", () => {
    const reactionStrip = readText('packages/app/features/collective/ReactionStrip.tsx')
    const mutations = readText('packages/app/state/collective/mutations.ts')
    const combined = reactionStrip + mutations
    expect(combined).toContain("captureEvent('collective_reaction_toggled'")
  })
})

describe('collective_report_submitted — wired at report submission, metadata only', () => {
  it("FlagAffordance.tsx or the ['collective','report'] mutation calls captureEvent('collective_report_submitted', ...), and the user's free-text note is never part of that call", () => {
    const flagAffordance = readText('packages/app/features/collective/FlagAffordance.tsx')
    const mutations = readText('packages/app/state/collective/mutations.ts')
    const combined = flagAffordance + mutations
    expect(combined).toContain("captureEvent('collective_report_submitted'")

    // Locate the captureEvent('collective_report_submitted', ...) call and
    // confirm its immediate argument text does not carry the free-text note.
    const callIdx = combined.indexOf("captureEvent('collective_report_submitted'")
    const callSnippet = combined.slice(callIdx, callIdx + 300)
    expect(callSnippet).not.toMatch(/\bnote\s*[:,]/)
  })
})

describe('subscription_cancel_initiated / subscription_cancel_confirmed — wired in CancelSubscriptionFlow', () => {
  it("runCancel() calls captureEvent('subscription_cancel_initiated', ...) at initiation", () => {
    const file = readText('packages/app/features/paid/CancelSubscriptionFlow.tsx')
    expect(file).toContain("captureEvent('subscription_cancel_initiated'")

    const runCancelIdx = file.indexOf('const runCancel')
    const initiatedIdx = file.indexOf("captureEvent('subscription_cancel_initiated'")
    expect(runCancelIdx).toBeGreaterThan(-1)
    expect(initiatedIdx).toBeGreaterThan(runCancelIdx)
  })

  it("the result.ok success branch calls captureEvent('subscription_cancel_confirmed', ...) exactly where onCancelled() fires", () => {
    const file = readText('packages/app/features/paid/CancelSubscriptionFlow.tsx')
    expect(file).toContain("captureEvent('subscription_cancel_confirmed'")

    const onCancelledIdx = file.indexOf('onCancelled()')
    expect(onCancelledIdx).toBeGreaterThan(-1)
    const nearby = file.slice(Math.max(0, onCancelledIdx - 300), onCancelledIdx + 100)
    expect(nearby).toContain("captureEvent('subscription_cancel_confirmed'")
  })
})
