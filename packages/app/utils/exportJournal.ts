import { zipSync, strToU8 } from 'fflate'
import type { DailyEntryView } from 'app/state/types'

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** 'single-file' = one .md; 'zip' = one .md per day in a ZIP */
  fileFormat: 'single-file' | 'zip'
  /** Whether to include ## HH:MM headings above each flow */
  showTimeHeadings: boolean
  /** Whether to show separators between flows */
  showSeparators: boolean
  /** Custom separator text (default '---') */
  separatorText: string
  /** Whether to include YAML frontmatter (date, words, flows) */
  showFrontmatter: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  fileFormat: 'zip',
  showTimeHeadings: true,
  showSeparators: true,
  separatorText: '---',
  showFrontmatter: true,
}

/** Sanitize a custom separator: strip control chars (including newlines), cap at 80 chars. */
export function sanitizeSeparator(text: string): string {
  return text.replace(/[\x00-\x1f]/g, '').slice(0, 80)
}

// ---------------------------------------------------------------------------
// Core formatting
// ---------------------------------------------------------------------------

/**
 * Format a single day's flows into a Markdown document.
 */
export function generateMarkdownForEntry(
  entry: DailyEntryView,
  options?: Partial<ExportOptions>
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options }
  const validFlows = entry.flows.filter((f) => f.content?.trim())
  if (validFlows.length === 0) return ''

  const totalWords = validFlows.reduce((sum, f) => sum + f.wordCount, 0)
  const lines: string[] = []

  // YAML frontmatter
  if (opts.showFrontmatter) {
    lines.push(
      '---',
      `date: ${entry.entryDate}`,
      `words: ${totalWords}`,
      `flows: ${validFlows.length}`,
      '---',
      ''
    )
  }

  validFlows.forEach((flow, i) => {
    if (opts.showTimeHeadings) {
      const time = new Date(flow.timestamp)
      const hh = String(time.getHours()).padStart(2, '0')
      const mm = String(time.getMinutes()).padStart(2, '0')
      lines.push(`## ${hh}:${mm}`)
      lines.push('')
    }

    lines.push(flow.content.trim())

    // Between flows (not after the last one)
    if (i < validFlows.length - 1) {
      lines.push('')
      if (opts.showSeparators) {
        lines.push(sanitizeSeparator(opts.separatorText))
        lines.push('')
      }
    } else {
      lines.push('')
    }
  })

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// ZIP export (one file per day)
// ---------------------------------------------------------------------------

/**
 * Generate a ZIP blob containing one Markdown file per day.
 */
export function exportJournal(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>
): Blob {
  const files: Record<string, Uint8Array> = {}

  for (const entry of entries) {
    const md = generateMarkdownForEntry(entry, options)
    if (!md) continue
    files[`${entry.entryDate}.md`] = strToU8(md)
  }

  const zipped = zipSync(files)
  return new Blob([zipped], { type: 'application/zip' })
}

// ---------------------------------------------------------------------------
// Single-file export (all entries in one .md)
// ---------------------------------------------------------------------------

/**
 * Generate a single Markdown blob containing all entries chronologically.
 */
export function exportJournalSingleFile(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>
): Blob {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options, showFrontmatter: false }
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate))

  const sections: string[] = []

  for (const entry of sorted) {
    const md = generateMarkdownForEntry(entry, opts)
    if (!md) continue
    sections.push(`# ${entry.entryDate}\n\n${md}`)
  }

  const entrySeparator = opts.showSeparators
    ? `\n${sanitizeSeparator(opts.separatorText)}\n\n`
    : '\n\n'
  const result = sections.join(entrySeparator)
  return new Blob([result], { type: 'text/markdown' })
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

/**
 * Derive the list of months that have entries, sorted newest-first.
 */
export function getAvailableMonths(
  entries: DailyEntryView[]
): { key: string; label: string }[] {
  const monthSet = new Set<string>()
  for (const entry of entries) {
    monthSet.add(entry.entryDate.slice(0, 7))
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  return Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const [year, month] = key.split('-')
      return { key, label: `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}` }
    })
}
