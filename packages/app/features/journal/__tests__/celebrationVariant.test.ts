// @vitest-environment node
// chooseCelebrationVariant pure function — table-driven tests
// RED-PHASE TDD: all tests fail against the not-yet-implemented function.

import { describe, expect, it } from 'vitest'
import { chooseCelebrationVariant } from '../celebrationVariant'
import type { LastSavedFlow, Flow, DailyEntryView } from 'app/state/types'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures & helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal Flow object for test fixtures.
 * Production flows have no `is_deleted` field (tombstoned flows are removed at sync boundary).
 */
function makeFlow(
  id: string,
  wordCount: number,
  timestamp: string,
  overrides: Partial<Flow> = {}
): Flow {
  return {
    id,
    dailyEntryId: 'entry-1',
    wordCount,
    content: '...',
    timestamp,
    local_session_id: 'test-session',
    ...overrides,
  }
}

/**
 * Build a minimal DailyEntryView with the given flows array.
 */
function makeEntry(flows: Flow[], entryDate = '2026-05-04'): DailyEntryView {
  return {
    id: 'entry-1',
    entryDate,
    lastModified: '2026-05-04T10:00:00.000Z',
    flows,
    totalWords: flows.reduce((sum, f) => sum + f.wordCount, 0),
  }
}

/**
 * Build a minimal LastSavedFlow object.
 */
function makeLastSaved(wordCount: number, timestamp: string): LastSavedFlow {
  return { wordCount, timestamp, content: '...' }
}

// Fixed timestamps for use across tests (T1 < T2 in lexicographic / chronological order)
const T1 = '2026-05-04T08:00:00.000Z'
const T2 = '2026-05-04T10:00:00.000Z'
const TODAY = '2026-05-04'

// ─────────────────────────────────────────────────────────────────────────────
// V1 — lastSavedFlow === null returns 'quieter'
// (Defensive default; the screen short-circuits to redirect but helper must not crash.)
// ─────────────────────────────────────────────────────────────────────────────
describe('chooseCelebrationVariant', () => {
  it('V1: lastSavedFlow === null returns quieter', () => {
    const flow = makeFlow('f1', 600, T1)
    const entry = makeEntry([flow])
    const result = chooseCelebrationVariant(null, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V2 — lastSavedFlow.wordCount < 500 returns 'quieter'
  // ─────────────────────────────────────────────────────────────────────────
  it('V2: lastSavedFlow.wordCount < 500 returns quieter', () => {
    const lastSaved = makeLastSaved(412, T1)
    const flow = makeFlow('f1', 412, T1)
    const entry = makeEntry([flow])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V3 — First 500-crossing flow today returns 'handoff'
  // todayEntry.flows = [{ wordCount: 612, timestamp: T1 }], lastSavedFlow matches
  // ─────────────────────────────────────────────────────────────────────────
  it('V3: first 500-crossing flow today returns handoff', () => {
    const lastSaved = makeLastSaved(612, T1)
    const flow = makeFlow('f1', 612, T1)
    const entry = makeEntry([flow])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('handoff')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V4 — Second 500-word flow today returns 'quieter'
  // todayEntry.flows has T1 flow (600 words) BEFORE T2 flow (700 words).
  // lastSavedFlow is the T2 flow — the just-saved one is NOT the first 500-crossing.
  // ─────────────────────────────────────────────────────────────────────────
  it('V4: second 500-crossing flow today returns quieter (first 500 was at T1, saved T2)', () => {
    const lastSaved = makeLastSaved(700, T2)
    const flow1 = makeFlow('f1', 600, T1)
    const flow2 = makeFlow('f2', 700, T2)
    const entry = makeEntry([flow1, flow2])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V5 — Second flow today, sub-500, returns 'quieter'
  // First flow (T1, 600 words) was the crossing. Now saving a sub-500 flow.
  // ─────────────────────────────────────────────────────────────────────────
  it('V5: second flow today sub-500 returns quieter', () => {
    const lastSaved = makeLastSaved(200, T2)
    const flow1 = makeFlow('f1', 600, T1)
    const flow2 = makeFlow('f2', 200, T2)
    const entry = makeEntry([flow1, flow2])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V6 — First flow today, sub-500, returns 'quieter'
  // Only one flow on today's entry; its wordCount is below threshold.
  // ─────────────────────────────────────────────────────────────────────────
  it('V6: first flow today sub-500 returns quieter', () => {
    const lastSaved = makeLastSaved(200, T1)
    const flow = makeFlow('f1', 200, T1)
    const entry = makeEntry([flow])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V7 — Tie-break: same timestamp, lexicographic id order
  // Two flows share T1. id 'a' < id 'b' — the lex-smallest id is the canonical "first".
  // Sub-case A: just-saved flow has id='a' (smallest) → handoff.
  // Sub-case B: just-saved flow has id='b' (not smallest) → quieter.
  // ─────────────────────────────────────────────────────────────────────────
  it('V7a: tie-break — just-saved is lex-smallest id at same timestamp → handoff', () => {
    // Both flows at T1; 'a' < 'b' lexicographically
    const lastSaved: LastSavedFlow = { wordCount: 700, timestamp: T1, content: '...' }
    const flowA = makeFlow('a', 700, T1) // lex-smallest — this is "first"
    const flowB = makeFlow('b', 600, T1)
    const entry = makeEntry([flowA, flowB])
    // lastSavedFlow.timestamp === T1, and among same-timestamp flows the lex-smallest id is 'a'
    // The just-saved flow IS the lex-smallest → handoff
    // Note: chooseCelebrationVariant must match on (timestamp, id); here id is not in LastSavedFlow,
    // so implementation matches by timestamp equality; tie-break is resolved by picking the
    // lex-smallest id among same-timestamp ≥500-word flows — if its timestamp === lastSavedFlow.timestamp, handoff.
    // This test documents that the FIRST flow by (timestamp asc, id asc) is 'a'.
    // The just-saved flow (T1) matches the first 500-crossing flow (also T1, id='a').
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('handoff')
  })

  it('V7b: tie-break — just-saved is NOT lex-smallest id at same timestamp → quieter', () => {
    // Both flows at T1; 'a' < 'b' lexicographically. The just-saved flow is 'b' (not 'a').
    // To simulate "just saved 'b'" when both have T1, we need the function to distinguish.
    // Since LastSavedFlow has no id field, the implementation uses timestamp match +
    // the tie-break identifies 'a' as the canonical first. If 'a' is already in the entry
    // with a different timestamp from lastSavedFlow, this is quieter.
    // Alternate framing: use different timestamps so 'b' comes first in time.
    // V7b: flow 'b' was saved earlier (lower timestamp T1), flow 'a' is the just-saved one (T2).
    // The first 500-crossing is 'b' at T1, but just-saved is 'a' at T2 → quieter.
    const lastSaved: LastSavedFlow = { wordCount: 600, timestamp: T2, content: '...' }
    const flowA = makeFlow('a', 600, T2) // just-saved; T2 > T1
    const flowB = makeFlow('b', 700, T1) // earlier; this is the first 500-crossing
    const entry = makeEntry([flowA, flowB])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V8 — Cross-day edge: lastSavedFlow timestamp date ≠ todayJournalDay → quieter
  // User crossed local midnight between save and celebration mount.
  // ─────────────────────────────────────────────────────────────────────────
  it('V8: lastSavedFlow timestamp date differs from todayJournalDay → quieter', () => {
    // The flow was saved on 2026-05-04 (ISO date of T_YESTERDAY) but today is 2026-05-05
    const T_YESTERDAY = '2026-05-04T23:59:59.000Z'
    const lastSaved = makeLastSaved(600, T_YESTERDAY)
    const flow = makeFlow('f1', 600, T_YESTERDAY)
    const entry = makeEntry([flow], '2026-05-04')
    const result = chooseCelebrationVariant(lastSaved, entry, '2026-05-05')
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V9 — todayEntry === null (no entry exists for today) → quieter
  // Defensive: in practice saveActiveFlowSession always creates an entry first,
  // but the function must not crash and must return quieter when todayEntry is null.
  // ─────────────────────────────────────────────────────────────────────────
  it('V9: todayEntry === null returns quieter even if lastSavedFlow.wordCount >= 500', () => {
    const lastSaved = makeLastSaved(600, T1)
    const result = chooseCelebrationVariant(lastSaved, null, TODAY)
    expect(result).toBe('quieter')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // V10 — Tombstoned flows are excluded at the sync boundary (documentation test)
  // The local Flow type has NO is_deleted field; deleted flows are removed from
  // flows$ by Legend-State's fieldDeleted mechanism before reaching this function.
  // This test documents the CONTRACT: chooseCelebrationVariant receives only
  // live flows in todayEntry.flows, and correctly identifies the first 500-crossing.
  //
  // Scenario: T1 flow was tombstoned/removed by sync; only T2 flow remains (live).
  // lastSavedFlow is the T2 flow. The function receives [T2 flow] as todayEntry.flows.
  // T2 is the only ≥500 flow → it IS the first → handoff.
  // ─────────────────────────────────────────────────────────────────────────
  it('V10: only live flows in todayEntry.flows; just-saved is the sole ≥500 flow → handoff', () => {
    // T1 flow was removed from flows$ (tombstoned); only T2 flow arrives in todayEntry.flows
    const lastSaved = makeLastSaved(700, T2)
    const flow2 = makeFlow('f2', 700, T2) // only live flow
    const entry = makeEntry([flow2])
    const result = chooseCelebrationVariant(lastSaved, entry, TODAY)
    expect(result).toBe('handoff')
  })
})
