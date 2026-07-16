import { describe, expect, it } from 'vitest'
import {
  generateMarkdownForEntry,
  exportJournal,
  exportJournalSingleFile,
  filterExportableEntries,
  getAvailableMonths,
  sanitizeSeparator,
  // NEW — target API for the export hardening work below; not implemented yet (red phase).
  computeExportSummary,
  renderSummaryMarkdown,
  exportJournalChunked,
  exportJournalSingleFileChunked,
} from '../exportJournal'
import { unzipSync, strFromU8 } from 'fflate'
import type { DailyEntryView } from 'app/state/types'

/** Helper to format HH:MM from a Date — matches the production code logic */
function localHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function makeEntry(
  date: string,
  flows: { time: string; content: string; words: number }[]
): DailyEntryView {
  return {
    id: `entry-${date}`,
    entryDate: date,
    lastModified: new Date().toISOString(),
    flows: flows.map((f, i) => ({
      id: `flow-${date}-${i}`,
      dailyEntryId: `entry-${date}`,
      timestamp: `${date}T${f.time}:00.000Z`,
      content: f.content,
      wordCount: f.words,
      local_session_id: 'test-session',
    })),
    totalWords: flows.reduce((s, f) => s + f.words, 0),
  }
}

// ---------------------------------------------------------------------------
// generateMarkdownForEntry — default options (backwards compat)
// ---------------------------------------------------------------------------

describe('generateMarkdownForEntry', () => {
  it('formats a single-flow entry with frontmatter', () => {
    const entry = makeEntry('2026-04-08', [{ time: '14:30', content: 'Hello **world**', words: 2 }])
    const md = generateMarkdownForEntry(entry)
    const expectedTime = localHHMM('2026-04-08T14:30:00.000Z')

    expect(md).toContain('---\ndate: 2026-04-08\nwords: 2\nflows: 1\n---')
    expect(md).toContain(`## ${expectedTime}`)
    expect(md).toContain('Hello **world**')
    expect(md.match(/^---$/gm)).toHaveLength(2) // only frontmatter delimiters
  })

  it('separates multiple flows with ---', () => {
    const entry = makeEntry('2026-04-08', [
      { time: '09:00', content: 'Morning flow', words: 2 },
      { time: '15:45', content: 'Afternoon flow', words: 2 },
    ])
    const md = generateMarkdownForEntry(entry)
    const expectedTime1 = localHHMM('2026-04-08T09:00:00.000Z')
    const expectedTime2 = localHHMM('2026-04-08T15:45:00.000Z')

    expect(md).toContain(`## ${expectedTime1}`)
    expect(md).toContain(`## ${expectedTime2}`)
    expect(md).toContain('words: 4')
    expect(md).toContain('flows: 2')
    expect(md.match(/^---$/gm)).toHaveLength(3) // frontmatter (2) + separator (1)
  })

  it('returns empty string when all flows are empty', () => {
    const entry = makeEntry('2026-04-08', [
      { time: '10:00', content: '', words: 0 },
      { time: '11:00', content: '   ', words: 0 },
    ])
    expect(generateMarkdownForEntry(entry)).toBe('')
  })

  it('preserves rich text formatting', () => {
    const content = '# Heading\n\n**bold** and *italic*\n\n> blockquote\n\n```\ncode\n```'
    const entry = makeEntry('2026-01-01', [{ time: '08:00', content, words: 10 }])
    const md = generateMarkdownForEntry(entry)

    expect(md).toContain('# Heading')
    expect(md).toContain('**bold** and *italic*')
    expect(md).toContain('> blockquote')
    expect(md).toContain('```\ncode\n```')
  })
})

// ---------------------------------------------------------------------------
// generateMarkdownForEntry — with options
// ---------------------------------------------------------------------------

describe('generateMarkdownForEntry with options', () => {
  const entry = makeEntry('2026-04-08', [
    { time: '09:00', content: 'Morning', words: 1 },
    { time: '15:00', content: 'Afternoon', words: 1 },
  ])

  it('hides time headings when showTimeHeadings is false', () => {
    const md = generateMarkdownForEntry(entry, { showTimeHeadings: false })
    expect(md).not.toContain('## ')
    expect(md).toContain('Morning')
    expect(md).toContain('Afternoon')
  })

  it('hides separators when showSeparators is false', () => {
    const md = generateMarkdownForEntry(entry, {
      showSeparators: false,
      showFrontmatter: false,
    })
    expect(md).not.toContain('---')
    expect(md).toContain('Morning')
    expect(md).toContain('Afternoon')
  })

  it('uses custom separator text', () => {
    const md = generateMarkdownForEntry(entry, {
      separatorText: '***',
      showFrontmatter: false,
    })
    expect(md).toContain('***')
    expect(md).not.toContain('---')
  })

  it('hides frontmatter when showFrontmatter is false', () => {
    const md = generateMarkdownForEntry(entry, { showFrontmatter: false })
    expect(md).not.toContain('date: ')
    expect(md).not.toContain('words: ')
    expect(md).not.toContain('flows: ')
    // Should still have the separator between flows
    expect(md).toContain('---')
  })

  it('outputs only content when all formatting options are off', () => {
    const md = generateMarkdownForEntry(entry, {
      showTimeHeadings: false,
      showSeparators: false,
      showFrontmatter: false,
    })
    expect(md).not.toContain('---')
    expect(md).not.toContain('## ')
    expect(md).not.toContain('date: ')
    expect(md).toContain('Morning')
    expect(md).toContain('Afternoon')
  })
})

// ---------------------------------------------------------------------------
// exportJournal (ZIP)
// ---------------------------------------------------------------------------

describe('exportJournal', () => {
  it('produces a ZIP with one file per entry', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '11:00', content: 'Day two', words: 2 }]),
    ]
    const blob = exportJournal(entries)
    expect(blob.type).toBe('application/zip')

    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    expect(Object.keys(unzipped)).toHaveLength(2)
  })

  it('names files by date', async () => {
    const entries = [
      makeEntry('2026-01-17', [{ time: '14:00', content: 'Content', words: 1 }]),
      makeEntry('2026-03-05', [{ time: '09:00', content: 'More content', words: 2 }]),
    ]
    const blob = exportJournal(entries)
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    expect(Object.keys(unzipped)).toContain('2026-01-17.md')
    expect(Object.keys(unzipped)).toContain('2026-03-05.md')
  })

  it('skips entries with no valid content', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Real content', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '11:00', content: '', words: 0 }]),
    ]
    const blob = exportJournal(entries)
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    expect(Object.keys(unzipped)).toEqual(['2026-04-08.md'])
  })

  it('preserves markdown content in ZIP files', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '14:30', content: 'Hello **world**', words: 2 }]),
    ]
    const blob = exportJournal(entries)
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const content = strFromU8(unzipped['2026-04-08.md']!)
    expect(content).toContain('Hello **world**')
    expect(content).toContain('date: 2026-04-08')
  })

  it('passes options through to generateMarkdownForEntry', async () => {
    const entries = [
      makeEntry('2026-04-08', [
        { time: '10:00', content: 'Content', words: 1 },
        { time: '14:00', content: 'More', words: 1 },
      ]),
    ]
    const blob = exportJournal(entries, { showTimeHeadings: false, separatorText: '***' })
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    const content = strFromU8(unzipped['2026-04-08.md']!)

    expect(content).not.toContain('## ')
    expect(content).toContain('***')
  })
})

// ---------------------------------------------------------------------------
// exportJournalSingleFile
// ---------------------------------------------------------------------------

describe('exportJournalSingleFile', () => {
  it('produces a text/markdown blob', () => {
    const entries = [makeEntry('2026-04-08', [{ time: '10:00', content: 'Hello', words: 1 }])]
    const blob = exportJournalSingleFile(entries)
    expect(blob.type).toBe('text/markdown')
  })

  it('includes date headings for each entry', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '11:00', content: 'Day two', words: 2 }]),
    ]
    const blob = exportJournalSingleFile(entries)
    const text = await blob.text()

    expect(text).toContain('# 2026-04-08')
    expect(text).toContain('# 2026-04-09')
  })

  it('sorts entries chronologically (oldest first)', async () => {
    const entries = [
      makeEntry('2026-04-09', [{ time: '10:00', content: 'Later', words: 1 }]),
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Earlier', words: 1 }]),
    ]
    const blob = exportJournalSingleFile(entries)
    const text = await blob.text()

    const idx08 = text.indexOf('# 2026-04-08')
    const idx09 = text.indexOf('# 2026-04-09')
    expect(idx08).toBeLessThan(idx09)
  })

  it('skips empty entries', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Real', words: 1 }]),
      makeEntry('2026-04-09', [{ time: '10:00', content: '', words: 0 }]),
    ]
    const blob = exportJournalSingleFile(entries)
    const text = await blob.text()

    expect(text).toContain('# 2026-04-08')
    expect(text).not.toContain('# 2026-04-09')
  })

  it('does not include YAML frontmatter', async () => {
    const entries = [makeEntry('2026-04-08', [{ time: '10:00', content: 'Hello', words: 1 }])]
    // Even if showFrontmatter is explicitly true, single-file suppresses it
    const blob = exportJournalSingleFile(entries, { showFrontmatter: true })
    const text = await blob.text()

    expect(text).not.toContain('date: 2026-04-08')
    expect(text).not.toContain('words: ')
    expect(text).not.toContain('flows: ')
  })

  it('respects showTimeHeadings and showSeparators options', async () => {
    const entries = [
      makeEntry('2026-04-08', [
        { time: '09:00', content: 'Morning', words: 1 },
        { time: '15:00', content: 'Afternoon', words: 1 },
      ]),
    ]
    const blob = exportJournalSingleFile(entries, {
      showTimeHeadings: false,
      showSeparators: false,
    })
    const text = await blob.text()

    expect(text).toContain('# 2026-04-08')
    expect(text).not.toContain('## ')
    expect(text).toContain('Morning')
    expect(text).toContain('Afternoon')
  })
})

// ---------------------------------------------------------------------------
// sanitizeSeparator
// ---------------------------------------------------------------------------

describe('sanitizeSeparator', () => {
  it('passes through normal text', () => {
    expect(sanitizeSeparator('---')).toBe('---')
    expect(sanitizeSeparator('***')).toBe('***')
    expect(sanitizeSeparator('~ ~ ~')).toBe('~ ~ ~')
  })

  it('truncates at 80 characters', () => {
    const long = 'x'.repeat(100)
    expect(sanitizeSeparator(long)).toHaveLength(80)
  })

  it('strips all control characters including newlines', () => {
    expect(sanitizeSeparator('hello\x00world')).toBe('helloworld')
    expect(sanitizeSeparator('tab\there')).toBe('tabhere')
    expect(sanitizeSeparator('line\nbreak')).toBe('linebreak')
    expect(sanitizeSeparator('cr\rhere')).toBe('crhere')
  })
})

// ---------------------------------------------------------------------------
// getAvailableMonths
// ---------------------------------------------------------------------------

describe('getAvailableMonths', () => {
  it('returns unique months sorted newest-first', () => {
    const entries = [
      makeEntry('2026-01-05', [{ time: '10:00', content: 'a', words: 1 }]),
      makeEntry('2026-01-20', [{ time: '10:00', content: 'b', words: 1 }]),
      makeEntry('2026-04-08', [{ time: '10:00', content: 'c', words: 1 }]),
      makeEntry('2025-12-31', [{ time: '10:00', content: 'd', words: 1 }]),
    ]
    const months = getAvailableMonths(entries)

    expect(months).toHaveLength(3)
    expect(months[0]!.key).toBe('2026-04')
    expect(months[0]!.label).toBe('April 2026')
    expect(months[1]!.key).toBe('2026-01')
    expect(months[1]!.label).toBe('January 2026')
    expect(months[2]!.key).toBe('2025-12')
    expect(months[2]!.label).toBe('December 2025')
  })

  it('returns empty array for no entries', () => {
    expect(getAvailableMonths([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// filterExportableEntries — cross-user defense
// ---------------------------------------------------------------------------

/** makeEntry variant that stamps user_id on the entry and each flow. */
function makeOwnedEntry(
  date: string,
  entryUserId: string | null,
  flows: { time: string; content: string; words: number; user_id?: string | null }[]
): DailyEntryView {
  const base = makeEntry(
    date,
    flows.map(({ time, content, words }) => ({ time, content, words }))
  )
  return {
    ...base,
    user_id: entryUserId,
    flows: base.flows.map((f, i) => ({ ...f, user_id: flows[i]!.user_id ?? entryUserId })),
  }
}

describe('filterExportableEntries (cross-user defense)', () => {
  it("keeps the current user's entries and anonymous local entries", () => {
    const entries = [
      makeOwnedEntry('2026-07-01', 'user-B', [{ time: '10:00', content: 'mine', words: 1 }]),
      makeOwnedEntry('2026-07-02', null, [
        { time: '10:00', content: 'anonymous', words: 1, user_id: null },
      ]),
    ]
    const result = filterExportableEntries(entries, 'user-B')
    expect(result).toHaveLength(2)
  })

  it('excludes entries owned by a different account entirely', () => {
    const entries = [
      makeOwnedEntry('2026-07-01', 'user-A', [
        { time: '10:00', content: 'previous user', words: 2 },
      ]),
      makeOwnedEntry('2026-07-02', 'user-B', [{ time: '10:00', content: 'mine', words: 1 }]),
    ]
    const result = filterExportableEntries(entries, 'user-B')
    expect(result).toHaveLength(1)
    expect(result[0]!.entryDate).toBe('2026-07-02')
  })

  it('excludes ALL account-owned entries when signed out (currentUserId null)', () => {
    const entries = [
      makeOwnedEntry('2026-07-01', 'user-A', [{ time: '10:00', content: 'owned', words: 1 }]),
      makeOwnedEntry('2026-07-02', null, [
        { time: '10:00', content: 'anonymous', words: 1, user_id: null },
      ]),
    ]
    const result = filterExportableEntries(entries, null)
    expect(result).toHaveLength(1)
    expect(result[0]!.entryDate).toBe('2026-07-02')
  })

  it('filters foreign flows inside a kept entry and recomputes totalWords', () => {
    const entries = [
      makeOwnedEntry('2026-07-01', 'user-B', [
        { time: '10:00', content: 'mine', words: 3, user_id: 'user-B' },
        { time: '11:00', content: 'not mine', words: 5, user_id: 'user-A' },
        { time: '12:00', content: 'anonymous local', words: 7, user_id: null },
      ]),
    ]
    const result = filterExportableEntries(entries, 'user-B')
    expect(result).toHaveLength(1)
    expect(result[0]!.flows.map((f) => f.content)).toEqual(['mine', 'anonymous local'])
    expect(result[0]!.totalWords).toBe(10)
  })

  it('does not mutate the input entries', () => {
    const entries = [
      makeOwnedEntry('2026-07-01', 'user-B', [
        { time: '10:00', content: 'mine', words: 3, user_id: 'user-B' },
        { time: '11:00', content: 'not mine', words: 5, user_id: 'user-A' },
      ]),
    ]
    filterExportableEntries(entries, 'user-B')
    expect(entries[0]!.flows).toHaveLength(2)
    expect(entries[0]!.totalWords).toBe(8)
  })

  it('returns entries untouched (same reference) when nothing is foreign', () => {
    const entry = makeOwnedEntry('2026-07-01', 'user-B', [
      { time: '10:00', content: 'mine', words: 3 },
    ])
    const result = filterExportableEntries([entry], 'user-B')
    expect(result[0]).toBe(entry)
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — per-flow word counts in generateMarkdownForEntry
// ---------------------------------------------------------------------------

describe('generateMarkdownForEntry — per-flow word counts', () => {
  it("shows each flow's own word count next to its time heading", () => {
    const entry = makeEntry('2026-04-08', [
      { time: '09:00', content: 'Morning flow text', words: 3 },
      { time: '15:00', content: 'Afternoon flow text here', words: 4 },
    ])
    const md = generateMarkdownForEntry(entry)
    const t1 = localHHMM('2026-04-08T09:00:00.000Z')
    const t2 = localHHMM('2026-04-08T15:00:00.000Z')

    expect(md).toContain(`## ${t1} · 3 words`)
    expect(md).toContain(`## ${t2} · 4 words`)
  })

  it('omits the per-flow word count when showFlowWordCounts is false but keeps the time heading', () => {
    const entry = makeEntry('2026-04-08', [{ time: '09:00', content: 'Morning', words: 1 }])
    const md = generateMarkdownForEntry(entry, { showFlowWordCounts: false })
    const t1 = localHHMM('2026-04-08T09:00:00.000Z')

    expect(md).toContain(`## ${t1}`)
    expect(md).not.toMatch(/## \d{2}:\d{2} · \d+ words/)
  })

  it('still shows no per-flow word count when time headings are off (piggybacks on the existing suppression path)', () => {
    const entry = makeEntry('2026-04-08', [{ time: '09:00', content: 'Morning', words: 1 }])
    const md = generateMarkdownForEntry(entry, { showTimeHeadings: false })

    expect(md).not.toContain('## ')
    expect(md).not.toMatch(/\d+ words/)
  })

  it('does not introduce a per-flow word count when every formatting option is off (existing "content only" contract)', () => {
    const entry = makeEntry('2026-04-08', [
      { time: '09:00', content: 'Morning', words: 1 },
      { time: '15:00', content: 'Afternoon', words: 1 },
    ])
    const md = generateMarkdownForEntry(entry, {
      showTimeHeadings: false,
      showSeparators: false,
      showFrontmatter: false,
    })

    expect(md).not.toMatch(/\d+ words/)
    expect(md).toContain('Morning')
    expect(md).toContain('Afternoon')
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — per-entry total word count, visible in single-file mode
// ---------------------------------------------------------------------------

describe('exportJournalSingleFile — per-entry total word count', () => {
  it('shows the total word count for an entry, human-visibly, without reintroducing YAML frontmatter', async () => {
    const entries = [
      makeEntry('2026-04-08', [
        { time: '09:00', content: 'Morning flow', words: 2 },
        { time: '15:00', content: 'Afternoon flow', words: 3 },
      ]),
    ]
    const blob = exportJournalSingleFile(entries)
    const text = await blob.text()

    const headingIdx = text.indexOf('# 2026-04-08')
    expect(headingIdx).toBeGreaterThanOrEqual(0)
    expect(text.slice(headingIdx, headingIdx + 200)).toMatch(/5 words total/)
    expect(text).not.toContain('date: ')
    expect(text).not.toContain('flows: ')
  })

  it('shows a distinct total for each entry across a multi-entry export', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'One two three', words: 3 }]),
      makeEntry('2026-04-09', [{ time: '10:00', content: 'Four five', words: 2 }]),
    ]
    const blob = exportJournalSingleFile(entries)
    const text = await blob.text()

    const idx08 = text.indexOf('# 2026-04-08')
    const idx09 = text.indexOf('# 2026-04-09')
    expect(text.slice(idx08, idx08 + 200)).toMatch(/3 words total/)
    expect(text.slice(idx09, idx09 + 200)).toMatch(/2 words total/)
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — computeExportSummary (pure)
// ---------------------------------------------------------------------------

describe('computeExportSummary', () => {
  it('returns all-zero totals for an empty export with a zero streak', () => {
    expect(computeExportSummary([], 0)).toEqual({
      totalEntries: 0,
      totalFlows: 0,
      totalWords: 0,
      longestStreak: 0,
    })
  })

  it('sums entries, flows, and words across a single entry', () => {
    const entry = makeEntry('2026-04-08', [
      { time: '09:00', content: 'Morning flow', words: 2 },
      { time: '15:00', content: 'Afternoon flow', words: 3 },
    ])
    expect(computeExportSummary([entry], 12)).toEqual({
      totalEntries: 1,
      totalFlows: 2,
      totalWords: 5,
      longestStreak: 12,
    })
  })

  it('sums across many entries and passes the injected longestStreak through untouched', () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '09:00', content: 'a', words: 1 }]),
      makeEntry('2026-04-09', [
        { time: '09:00', content: 'b', words: 2 },
        { time: '10:00', content: 'c', words: 3 },
      ]),
    ]
    const summary = computeExportSummary(entries, 42)
    expect(summary.totalEntries).toBe(2)
    expect(summary.totalFlows).toBe(3)
    expect(summary.totalWords).toBe(6)
    expect(summary.longestStreak).toBe(42)
  })

  it('excludes entries and flows with no valid content, mirroring what actually lands in the file', () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '09:00', content: 'Real content', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '09:00', content: '   ', words: 0 }]),
      makeEntry('2026-04-10', [
        { time: '09:00', content: 'Kept', words: 1 },
        { time: '10:00', content: '', words: 0 },
      ]),
    ]
    const summary = computeExportSummary(entries, 5)
    expect(summary.totalEntries).toBe(2) // 04-09 has no non-empty flows, so it is excluded entirely
    expect(summary.totalFlows).toBe(2) // the two non-empty flows across the two kept entries
    expect(summary.totalWords).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — renderSummaryMarkdown (pure)
// ---------------------------------------------------------------------------

describe('renderSummaryMarkdown', () => {
  it('renders a deterministic block containing all four totals', () => {
    const md = renderSummaryMarkdown({
      totalEntries: 3,
      totalFlows: 5,
      totalWords: 120,
      longestStreak: 12,
    })
    expect(md).toContain('3')
    expect(md).toContain('5')
    expect(md).toContain('120')
    expect(md).toContain('12')
    expect(md.toLowerCase()).toContain('entries')
    expect(md.toLowerCase()).toContain('flows')
    expect(md.toLowerCase()).toContain('words')
    expect(md.toLowerCase()).toContain('streak')
  })

  it('produces byte-identical output for the same summary input (deterministic)', () => {
    const summary = { totalEntries: 1, totalFlows: 1, totalWords: 10, longestStreak: 1 }
    expect(renderSummaryMarkdown(summary)).toBe(renderSummaryMarkdown(summary))
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — summary wired into exportJournal (ZIP) as 000-summary.md
// ---------------------------------------------------------------------------

describe('exportJournal (ZIP) — aggregate summary file', () => {
  it('adds a 000-summary.md entry (matching the pure renderer) that sorts first when longestStreak is provided', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '11:00', content: 'Day two', words: 3 }]),
    ]
    const longestStreak = 12
    const blob = exportJournal(entries, undefined, longestStreak)
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    const names = Object.keys(unzipped)

    expect(names).toContain('000-summary.md')
    expect(names).toHaveLength(3)
    expect([...names].sort()[0]).toBe('000-summary.md')

    const expected = renderSummaryMarkdown(computeExportSummary(entries, longestStreak))
    expect(strFromU8(unzipped['000-summary.md']!).trim()).toBe(expected.trim())
  })

  it('omits the summary file when longestStreak is not provided (backward compatible with existing callers)', async () => {
    const entries = [makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }])]
    const blob = exportJournal(entries)
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    expect(Object.keys(unzipped)).not.toContain('000-summary.md')
    expect(Object.keys(unzipped)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — summary wired into exportJournalSingleFile as a footer
// ---------------------------------------------------------------------------

describe('exportJournalSingleFile — aggregate summary footer', () => {
  it('appends the summary (matching the pure renderer) after the last entry section when longestStreak is provided', async () => {
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }]),
      makeEntry('2026-04-09', [{ time: '11:00', content: 'Day two', words: 3 }]),
    ]
    const longestStreak = 9
    const blob = exportJournalSingleFile(entries, undefined, longestStreak)
    const text = await blob.text()

    const expected = renderSummaryMarkdown(computeExportSummary(entries, longestStreak)).trim()
    expect(text).toContain(expected)

    const lastEntryIdx = text.lastIndexOf('# 2026-04-09')
    const summaryIdx = text.indexOf(expected)
    expect(lastEntryIdx).toBeGreaterThanOrEqual(0)
    expect(summaryIdx).toBeGreaterThan(lastEntryIdx)
  })

  it('omits the footer when longestStreak is not provided (backward compatible with existing callers)', async () => {
    const entries = [makeEntry('2026-04-08', [{ time: '10:00', content: 'Day one', words: 2 }])]
    const withoutFooter = await exportJournalSingleFile(entries).text()
    const withFooter = await exportJournalSingleFile(entries, undefined, 5).text()
    expect(withFooter.length).toBeGreaterThan(withoutFooter.length)
    expect(withoutFooter).not.toContain('Longest streak')
  })
})

// ---------------------------------------------------------------------------
// NEW (red phase) — chunked generation: determinism + progress
// ---------------------------------------------------------------------------

function makeManyEntries(count: number): DailyEntryView[] {
  const base = new Date('2020-01-01T00:00:00.000Z')
  const out: DailyEntryView[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 86_400_000)
    const dateStr = d.toISOString().slice(0, 10)
    out.push(
      makeEntry(dateStr, [{ time: '09:00', content: `Synthetic entry ${i} body text`, words: 5 }])
    )
  }
  return out
}

describe('exportJournalChunked — determinism vs. the synchronous ZIP path', () => {
  it('produces byte-identical unzipped contents to exportJournal for the same input', async () => {
    const entries = makeManyEntries(250)
    const syncBlob = exportJournal(entries, undefined, 30)
    const chunkedBlob = await exportJournalChunked(entries, undefined, 30)

    const syncFiles = unzipSync(new Uint8Array(await syncBlob.arrayBuffer()))
    const chunkedFiles = unzipSync(new Uint8Array(await chunkedBlob.arrayBuffer()))

    expect(Object.keys(chunkedFiles).sort()).toEqual(Object.keys(syncFiles).sort())
    for (const name of Object.keys(syncFiles)) {
      expect(strFromU8(chunkedFiles[name]!)).toBe(strFromU8(syncFiles[name]!))
    }
  })

  it('reports monotonically increasing progress across more than one batch, finishing at (total, total)', async () => {
    const entries = makeManyEntries(250)
    const calls: Array<[number, number]> = []
    await exportJournalChunked(entries, undefined, 30, (done, total) => {
      calls.push([done, total])
    })

    expect(calls.length).toBeGreaterThan(1)
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]![0]).toBeGreaterThan(calls[i - 1]![0])
    }
    const [lastDone, lastTotal] = calls[calls.length - 1]!
    expect(lastDone).toBe(lastTotal)
    expect(lastTotal).toBe(250)
  })
})

describe('exportJournalSingleFileChunked — determinism vs. the synchronous single-file path', () => {
  it('produces byte-identical Markdown text to exportJournalSingleFile for the same input', async () => {
    const entries = makeManyEntries(250)
    const syncBlob = exportJournalSingleFile(entries, undefined, 30)
    const chunkedBlob = await exportJournalSingleFileChunked(entries, undefined, 30)

    expect(await chunkedBlob.text()).toBe(await syncBlob.text())
  })

  it('calls onProgress and completes even for a very small (single-entry) export', async () => {
    const entries = makeManyEntries(1)
    const calls: Array<[number, number]> = []
    const blob = await exportJournalSingleFileChunked(
      entries,
      undefined,
      undefined,
      (done, total) => {
        calls.push([done, total])
      }
    )

    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[calls.length - 1]).toEqual([1, 1])
    expect(await blob.text()).toContain('Synthetic entry 0 body text')
  })
})

// ---------------------------------------------------------------------------
// Per-flow word counts flow through the ZIP archive by default
// ---------------------------------------------------------------------------

describe('exportJournal (ZIP) — per-flow word counts by default', () => {
  it("surfaces each flow's own word count inside the archived per-day file", async () => {
    const entries = [
      makeEntry('2026-04-08', [
        { time: '09:00', content: 'Morning flow text', words: 3 },
        { time: '15:00', content: 'Afternoon flow text here', words: 4 },
      ]),
    ]
    const blob = exportJournal(entries)
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const content = strFromU8(unzipped['2026-04-08.md']!)
    const t1 = localHHMM('2026-04-08T09:00:00.000Z')
    const t2 = localHHMM('2026-04-08T15:00:00.000Z')

    expect(content).toContain(`## ${t1} · 3 words`)
    expect(content).toContain(`## ${t2} · 4 words`)
    // Per-day aggregate frontmatter is still present and unchanged.
    expect(content).toContain('words: 7')
  })
})

// ---------------------------------------------------------------------------
// Summary file renders for a single-entry ZIP export
// ---------------------------------------------------------------------------

describe('exportJournal (ZIP) — summary for a single-entry export', () => {
  it('still emits a 000-summary.md matching the pure renderer for one entry', async () => {
    const entries = [makeEntry('2026-04-08', [{ time: '10:00', content: 'Solo day', words: 2 }])]
    const longestStreak = 1
    const blob = exportJournal(entries, undefined, longestStreak)
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))

    const expected = renderSummaryMarkdown(computeExportSummary(entries, longestStreak))
    expect(strFromU8(unzipped['000-summary.md']!).trim()).toBe(expected.trim())
    expect(strFromU8(unzipped['000-summary.md']!)).toContain('Longest streak: 1 days')
  })
})
