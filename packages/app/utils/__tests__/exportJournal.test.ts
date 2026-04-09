import { describe, expect, it } from 'vitest'
import {
  generateMarkdownForEntry,
  exportJournal,
  exportJournalSingleFile,
  getAvailableMonths,
  sanitizeSeparator,
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
    const entry = makeEntry('2026-04-08', [
      { time: '14:30', content: 'Hello **world**', words: 2 },
    ])
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
    const entry = makeEntry('2026-01-01', [
      { time: '08:00', content, words: 10 },
    ])
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
      makeEntry('2026-04-08', [
        { time: '14:30', content: 'Hello **world**', words: 2 },
      ]),
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
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Hello', words: 1 }]),
    ]
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
    const entries = [
      makeEntry('2026-04-08', [{ time: '10:00', content: 'Hello', words: 1 }]),
    ]
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

  it('strips control characters except newline', () => {
    expect(sanitizeSeparator('hello\x00world')).toBe('helloworld')
    expect(sanitizeSeparator('tab\there')).toBe('tabhere')
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
