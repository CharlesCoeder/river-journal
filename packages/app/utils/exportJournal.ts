import { zipSync, strToU8 } from 'fflate'
import type { DailyEntryView } from 'app/state/types'
import { toExportBlob } from 'app/utils/exportBlob'

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** 'single-file' = one .md; 'zip' = one .md per day in a ZIP */
  fileFormat: 'single-file' | 'zip'
  /** Whether to include ## HH:MM headings above each flow */
  showTimeHeadings: boolean
  /** Whether to append each flow's own word count to its time heading */
  showFlowWordCounts: boolean
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
  showFlowWordCounts: true,
  showSeparators: true,
  separatorText: '---',
  showFrontmatter: true,
}

/**
 * Batch size for the yielding export paths. Kept as a named constant so the
 * chunk/yield cadence is a single, explicit tuning point rather than a magic
 * number scattered across the two chunked generators.
 */
const EXPORT_BATCH_SIZE = 50

/**
 * Pause (ms) between generation batches. Roughly one animation frame, so the
 * main thread is handed back long enough for the browser to paint the live
 * progress text before the next batch runs — keeping generation off the
 * blocking path rather than starving the renderer with back-to-back macrotasks.
 */
const BATCH_YIELD_MS = 16

/** Hand the main thread back for ~a frame so a long export never blocks the UI. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, BATCH_YIELD_MS))
}

/** Sanitize a custom separator: strip control chars (including newlines), cap at 80 chars. */
export function sanitizeSeparator(text: string): string {
  return text.replace(/[\x00-\x1f]/g, '').slice(0, 80)
}

// ---------------------------------------------------------------------------
// Cross-user defense
// ---------------------------------------------------------------------------

/**
 * Filters the local entry pool down to what the CURRENT identity may export.
 *
 * Local Legend-State data survives sign-out by design (the previous-account
 * banner in Settings owns the delete/keep decision), so after an account
 * switch the pool can contain the previous account's plaintext entries.
 * Export must never dump those — same ownership rule as
 * `restoreExcludedEntries` in state/store.ts:
 *
 *   - An entry owned by a DIFFERENT (non-null) user is excluded entirely.
 *   - Anonymous local data (user_id null/undefined) is always exportable —
 *     it was authored on this device outside any account.
 *   - When signed out (`currentUserId` null), every account-owned entry is
 *     excluded; only anonymous local data remains exportable.
 *   - Within a kept entry, flows are filtered by the same rule (defends the
 *     sign-out-window edge where a foreign flow sits under a kept entry) and
 *     `totalWords` is recomputed for the kept flows.
 */
export function filterExportableEntries(
  entries: DailyEntryView[],
  currentUserId: string | null
): DailyEntryView[] {
  const ownedByOther = (userId: string | null | undefined): boolean =>
    !!userId && userId !== currentUserId

  const result: DailyEntryView[] = []
  for (const entry of entries) {
    if (ownedByOther(entry.user_id)) continue
    const flows = entry.flows.filter((f) => !ownedByOther(f.user_id))
    if (flows.length === entry.flows.length) {
      result.push(entry)
    } else {
      result.push({
        ...entry,
        flows,
        totalWords: flows.reduce((sum, f) => sum + f.wordCount, 0),
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Core formatting
// ---------------------------------------------------------------------------

/** Flows that actually carry content — the single inclusion rule for what lands in the file. */
function exportableFlows(entry: DailyEntryView) {
  return entry.flows.filter((f) => f.content?.trim())
}

/**
 * Format a single day's flows into a Markdown document.
 */
export function generateMarkdownForEntry(
  entry: DailyEntryView,
  options?: Partial<ExportOptions>
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options }
  const validFlows = exportableFlows(entry)
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
      // Per-flow word count rides on the time heading additively: with headings
      // off (or the count suppressed) the "content only" output paths stay clean.
      const heading = opts.showFlowWordCounts
        ? `## ${hh}:${mm} · ${flow.wordCount} words`
        : `## ${hh}:${mm}`
      lines.push(heading)
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
// Aggregate summary (pure)
// ---------------------------------------------------------------------------

export interface ExportSummary {
  totalEntries: number
  totalFlows: number
  totalWords: number
  longestStreak: number
}

/**
 * Compute the aggregate summary over the entries that will actually land in the
 * export. Pure and store-free: `longestStreak` is passed in (sourced from the
 * wired, current-user-scoped streak view) rather than recomputed here, so this
 * module keeps its zero-store, zero-network shape. Entries/flows with no
 * non-empty content are excluded, mirroring `generateMarkdownForEntry`'s
 * inclusion rule so the totals match the file byte-for-byte.
 */
export function computeExportSummary(
  entries: DailyEntryView[],
  longestStreak: number
): ExportSummary {
  let totalEntries = 0
  let totalFlows = 0
  let totalWords = 0
  for (const entry of entries) {
    const validFlows = exportableFlows(entry)
    if (validFlows.length === 0) continue
    totalEntries++
    totalFlows += validFlows.length
    totalWords += validFlows.reduce((sum, f) => sum + f.wordCount, 0)
  }
  return { totalEntries, totalFlows, totalWords, longestStreak }
}

/**
 * Render the aggregate summary as a deterministic Markdown block, reused
 * verbatim as the single-file footer and the ZIP archive's summary file.
 */
export function renderSummaryMarkdown(summary: ExportSummary): string {
  return [
    '## Export summary',
    '',
    `- Entries: ${summary.totalEntries}`,
    `- Flows: ${summary.totalFlows}`,
    `- Words: ${summary.totalWords}`,
    `- Longest streak: ${summary.longestStreak} days`,
    '',
  ].join('\n')
}

/** Fixed archive name for the summary; the `000-` prefix sorts it to the top. */
const SUMMARY_FILE_NAME = '000-summary.md'

// ---------------------------------------------------------------------------
// ZIP export (one file per day)
// ---------------------------------------------------------------------------

/**
 * Build the { filename → bytes } map for the ZIP archive. Adds the summary file
 * only when a `longestStreak` is supplied, so callers that don't opt into the
 * summary get the original one-file-per-day archive unchanged.
 */
function buildZipFileMap(
  entries: DailyEntryView[],
  options: Partial<ExportOptions> | undefined,
  longestStreak: number | undefined,
  files: Record<string, Uint8Array>
): void {
  for (const entry of entries) {
    const md = generateMarkdownForEntry(entry, options)
    if (!md) continue
    files[`${entry.entryDate}.md`] = strToU8(md)
  }
  if (longestStreak !== undefined) {
    files[SUMMARY_FILE_NAME] = strToU8(
      renderSummaryMarkdown(computeExportSummary(entries, longestStreak))
    )
  }
}

/**
 * Generate a ZIP blob containing one Markdown file per day. When `longestStreak`
 * is provided, a `000-summary.md` aggregate file is added at the top.
 */
export function exportJournal(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>,
  longestStreak?: number
): Blob {
  const files: Record<string, Uint8Array> = {}
  buildZipFileMap(entries, options, longestStreak, files)
  return toExportBlob(zipSync(files), 'application/zip')
}

/**
 * Chunked counterpart to `exportJournal`: generates per-day Markdown in batches
 * that yield to the event loop between batches (so large exports never block the
 * UI for more than a frame) and reports `onProgress(done, total)` after each
 * batch. Produces byte-identical archive contents to the synchronous path for
 * the same input — the ZIP assembly (`zipSync`) is cheap relative to per-entry
 * Markdown generation, so only the generation loop is broken up.
 */
export async function exportJournalChunked(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>,
  longestStreak?: number,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const total = entries.length
  for (let i = 0; i < total; i += EXPORT_BATCH_SIZE) {
    const batch = entries.slice(i, i + EXPORT_BATCH_SIZE)
    for (const entry of batch) {
      const md = generateMarkdownForEntry(entry, options)
      if (md) files[`${entry.entryDate}.md`] = strToU8(md)
    }
    const done = Math.min(i + EXPORT_BATCH_SIZE, total)
    onProgress?.(done, total)
    if (done < total) await yieldToEventLoop()
  }
  if (longestStreak !== undefined) {
    files[SUMMARY_FILE_NAME] = strToU8(
      renderSummaryMarkdown(computeExportSummary(entries, longestStreak))
    )
  }
  return toExportBlob(zipSync(files), 'application/zip')
}

// ---------------------------------------------------------------------------
// Single-file export (all entries in one .md)
// ---------------------------------------------------------------------------

/**
 * Build one entry's single-file section, or '' if it has no content. Surfaces
 * the per-entry total word count human-visibly (single-file mode suppresses the
 * YAML frontmatter that carries it in ZIP mode).
 */
function buildSingleFileSection(entry: DailyEntryView, opts: Partial<ExportOptions>): string {
  const md = generateMarkdownForEntry(entry, opts)
  if (!md) return ''
  const totalWords = exportableFlows(entry).reduce((sum, f) => sum + f.wordCount, 0)
  return `# ${entry.entryDate}\n\n${totalWords} words total\n\n${md}`
}

/** Join the built sections and append the summary footer when requested. */
function assembleSingleFile(
  sections: string[],
  opts: ExportOptions,
  entries: DailyEntryView[],
  longestStreak: number | undefined
): string {
  const entrySeparator = opts.showSeparators
    ? `\n${sanitizeSeparator(opts.separatorText)}\n\n`
    : '\n\n'
  let result = sections.join(entrySeparator)
  if (longestStreak !== undefined) {
    result += `\n\n${renderSummaryMarkdown(computeExportSummary(entries, longestStreak))}`
  }
  return result
}

/**
 * Generate a single Markdown blob containing all entries chronologically. When
 * `longestStreak` is provided, an aggregate summary is appended as a footer.
 */
export function exportJournalSingleFile(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>,
  longestStreak?: number
): Blob {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options, showFrontmatter: false }
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate))

  const sections: string[] = []
  for (const entry of sorted) {
    const section = buildSingleFileSection(entry, opts)
    if (section) sections.push(section)
  }

  return toExportBlob(assembleSingleFile(sections, opts, entries, longestStreak), 'text/markdown')
}

/**
 * Chunked counterpart to `exportJournalSingleFile`: builds per-day sections in
 * batches that yield between batches and reports `onProgress(done, total)`.
 * Produces byte-identical Markdown to the synchronous path for the same input.
 */
export async function exportJournalSingleFileChunked(
  entries: DailyEntryView[],
  options?: Partial<ExportOptions>,
  longestStreak?: number,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options, showFrontmatter: false }
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate))

  const sections: string[] = []
  const total = sorted.length
  for (let i = 0; i < total; i += EXPORT_BATCH_SIZE) {
    const batch = sorted.slice(i, i + EXPORT_BATCH_SIZE)
    for (const entry of batch) {
      const section = buildSingleFileSection(entry, opts)
      if (section) sections.push(section)
    }
    const done = Math.min(i + EXPORT_BATCH_SIZE, total)
    onProgress?.(done, total)
    if (done < total) await yieldToEventLoop()
  }

  return toExportBlob(assembleSingleFile(sections, opts, entries, longestStreak), 'text/markdown')
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
      // `key` is always 'YYYY-MM' (built via entryDate.slice(0, 7)), so the
      // split yields both parts — `month!` is always valid.
      const [year, month] = key.split('-')
      return { key, label: `${MONTH_NAMES[parseInt(month!, 10) - 1]} ${year}` }
    })
}
