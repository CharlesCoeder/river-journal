/**
 * Unit tests for the pure local search function (`state/search.ts`).
 *
 * The function is pure and synchronous: it takes a plain array of day views,
 * a query string, and the current identity, and returns one result row per
 * matching day. These tests pin its decidable surface — the query minimum,
 * case folding, the ownership scope it inherits from the export filter,
 * snippet extraction at content boundaries, and descending date grouping —
 * plus the two contract guarantees the surface depends on: it touches no
 * network client, and it stays within a tight time budget on a large corpus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DailyEntryView, Flow } from 'app/state/types'

// The pure module must never reach a network client. Mock the Supabase module
// so that, if the search path ever imported it, any call would be observable —
// and assert below that nothing on the path touches it.
const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))

import { searchFlows, extractSnippet } from 'app/state/search'

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function makeFlow(content: string, userId: string | null | undefined, dailyEntryId: string): Flow {
  return {
    id: nextId('flow'),
    dailyEntryId,
    timestamp: '2026-04-10T12:00:00Z',
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    user_id: userId,
    local_session_id: 'session',
  }
}

function makeDay(
  date: string,
  userId: string | null | undefined,
  contents: string[]
): DailyEntryView {
  const id = nextId('entry')
  const flows = contents.map((c) => makeFlow(c, userId, id))
  return {
    id,
    entryDate: date,
    lastModified: `${date}T12:00:00Z`,
    user_id: userId,
    flows,
    totalWords: flows.reduce((sum, f) => sum + f.wordCount, 0),
  }
}

beforeEach(() => {
  idCounter = 0
  rpcMock.mockClear()
  fromMock.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────────
// Minimum query length
// ─────────────────────────────────────────────────────────────────────────────
describe('minimum query length', () => {
  const days = [makeDay('2026-04-10', 'me', ['a note about the river'])]

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['single character', 'r'],
    ['single character with surrounding whitespace', '  r  '],
  ])('returns no results for a %s query', (_label, query) => {
    expect(searchFlows(days, query, 'me')).toEqual([])
  })

  it('returns results for a two-character query', () => {
    expect(searchFlows(days, 'ri', 'me').length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case folding + multi-word queries
// ─────────────────────────────────────────────────────────────────────────────
describe('case-insensitive, multi-word matching', () => {
  it.each([
    ['lowercase query, mixed content', 'river', 'A note about the RiVeR at dawn'],
    ['uppercase query, lowercase content', 'RIVER', 'a note about the river at dawn'],
    ['mixed query, uppercase content', 'RiVeR', 'A NOTE ABOUT THE RIVER'],
  ])('matches regardless of case (%s)', (_label, query, content) => {
    const days = [makeDay('2026-04-10', 'me', [content])]
    expect(searchFlows(days, query, 'me').length).toBe(1)
  })

  it('matches a multi-word query as a contiguous substring', () => {
    const days = [makeDay('2026-04-10', 'me', ['walking by the river current at dusk'])]
    expect(searchFlows(days, 'river current', 'me').length).toBe(1)
  })

  it('does not match when the multi-word phrase is not contiguous', () => {
    const days = [makeDay('2026-04-10', 'me', ['the river was calm and the current slow'])]
    expect(searchFlows(days, 'river current', 'me')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ownership scoping (delegated to filterExportableEntries)
// ─────────────────────────────────────────────────────────────────────────────
describe('ownership scoping', () => {
  it('excludes a day owned by a different, non-null identity', () => {
    const days = [
      makeDay('2026-04-10', 'me', ['mine token']),
      makeDay('2026-04-09', 'other', ['foreign token']),
    ]
    const rows = searchFlows(days, 'token', 'me')
    expect(rows.length).toBe(1)
    expect(rows[0]!.entryDate).toBe('2026-04-10')
  })

  it('includes anonymous data (user_id null) regardless of current identity', () => {
    const days = [makeDay('2026-04-08', null, ['anonymous token'])]
    expect(searchFlows(days, 'token', 'me').length).toBe(1)
  })

  it('includes anonymous data (user_id undefined) regardless of current identity', () => {
    const days = [makeDay('2026-04-08', undefined, ['anonymous token'])]
    expect(searchFlows(days, 'token', 'me').length).toBe(1)
  })

  it('when signed out, excludes account-owned data but keeps anonymous data', () => {
    const days = [
      makeDay('2026-04-10', 'other', ['account-owned token']),
      makeDay('2026-04-08', null, ['anonymous token']),
    ]
    const rows = searchFlows(days, 'token', null)
    expect(rows.length).toBe(1)
    expect(rows[0]!.entryDate).toBe('2026-04-08')
  })

  it('counts only ownership-surviving flows in the day flow count', () => {
    const day = makeDay('2026-04-10', 'me', ['first token', 'second note'])
    // Splice a foreign flow onto the same day; it must not inflate the count.
    day.flows.push(makeFlow('foreign note', 'other', day.id))
    const rows = searchFlows([day], 'token', 'me')
    expect(rows.length).toBe(1)
    expect(rows[0]!.flowCount).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Snippet extraction at content boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe('extractSnippet boundary handling', () => {
  it('never produces a negative offset when the match is at the very start', () => {
    const content = 'token appears right at the beginning of this passage of writing'
    const { snippet, matchStart, matchLength } = extractSnippet(content, 0, 'token'.length)
    expect(matchStart).toBe(0)
    expect(matchStart).toBeGreaterThanOrEqual(0)
    expect(snippet.slice(matchStart, matchStart + matchLength).toLowerCase()).toBe('token')
  })

  it('never over-slices when the match is at the very end', () => {
    const content = 'this passage of writing ends on the exact word token'
    const idx = content.indexOf('token')
    const { snippet, matchStart, matchLength } = extractSnippet(content, idx, 'token'.length)
    expect(matchStart + matchLength).toBeLessThanOrEqual(snippet.length)
    expect(snippet.slice(matchStart, matchStart + matchLength).toLowerCase()).toBe('token')
  })

  it('returns the whole of a short (<80 char) flow with a correct in-snippet offset', () => {
    const content = 'short token here'
    const idx = content.indexOf('token')
    const { snippet, matchStart, matchLength } = extractSnippet(content, idx, 'token'.length)
    expect(snippet).toBe(content)
    expect(matchStart).toBe(idx)
    expect(snippet.slice(matchStart, matchStart + matchLength)).toBe('token')
  })

  it('centers a roughly 80-character window on a match in the middle of long content', () => {
    const before = 'x'.repeat(200)
    const after = 'y'.repeat(200)
    const content = `${before}token${after}`
    const { snippet, matchStart, matchLength } = extractSnippet(
      content,
      before.length,
      'token'.length
    )
    expect(snippet.length).toBeLessThanOrEqual(90)
    expect(snippet.slice(matchStart, matchStart + matchLength)).toBe('token')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Grouping + ordering + snippet content in results
// ─────────────────────────────────────────────────────────────────────────────
describe('grouping and ordering', () => {
  it('returns one row per matching day, ordered newest-first', () => {
    const days = [
      makeDay('2026-04-08', 'me', ['earliest token']),
      makeDay('2026-04-12', 'me', ['latest token']),
      makeDay('2026-04-10', 'me', ['middle token']),
    ]
    const rows = searchFlows(days, 'token', 'me')
    expect(rows.map((r) => r.entryDate)).toEqual(['2026-04-12', '2026-04-10', '2026-04-08'])
  })

  it('extracts the snippet from the first matching flow of the day', () => {
    const day = makeDay('2026-04-10', 'me', ['no hit here', 'the token lives in the second flow'])
    const rows = searchFlows([day], 'token', 'me')
    expect(rows.length).toBe(1)
    expect(rows[0]!.snippet).toContain('token')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Zero-network guarantee
// ─────────────────────────────────────────────────────────────────────────────
describe('touches no network client', () => {
  it('does not call the Supabase client or the global fetch when searching', () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const days = [makeDay('2026-04-10', 'me', ['a note about offline currents'])]
    const rows = searchFlows(days, 'offline', 'me')
    expect(rows.length).toBe(1)

    expect(rpcMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    globalThis.fetch = originalFetch
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Performance budget
// ─────────────────────────────────────────────────────────────────────────────
describe('performance budget', () => {
  it('scans a ~1,000-entry / ~500-word corpus within 200ms', () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    const days: DailyEntryView[] = Array.from({ length: 999 }, (_, i) => {
      const date = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      return makeDay(date, 'me', [words])
    })
    days.push(makeDay('2026-04-15', 'me', [`${words} distinctperfmarker ${words}`]))

    const start = performance.now()
    const rows = searchFlows(days, 'distinctperfmarker', 'me')
    const elapsed = performance.now() - start

    expect(rows.length).toBe(1)
    expect(elapsed).toBeLessThan(200)
  })
})
