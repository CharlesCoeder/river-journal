// @vitest-environment happy-dom
/**
 * Red-phase tests for the ExportJournal settings component.
 *
 * ExportJournal.tsx is stubbed out everywhere it's currently referenced
 * (SettingsScreen.*.test.tsx all mock it away), so no existing test mounts
 * the real component. This file mounts the REAL component against a local
 * `app/state/store` mock (getter-observable pattern, following
 * HomeScreen.collective-gate.test.tsx) and exercises it through the REAL
 * `app/utils/exportJournal` formatter (unmocked) so the assertions below
 * are true integration checks of the export workflow a user drives from
 * Settings, not a mock-verifies-mock exercise.
 *
 * Target behavior under test (none of it exists yet — red phase):
 *   - a calm, live "Exporting N of M entries…" text progress indicator
 *     replaces the old static "Preparing export..." message, with no
 *     spinner/activity-indicator ever rendered
 *   - the export never performs a network request
 *   - a signed-out (anonymous) user can export their local-only entries
 *     with no auth, while a previous account's data is excluded
 *   - the already-decrypted plaintext the component reads is what lands
 *     in the exported file, verbatim
 *   - the delivery seam (downloadExport + filenames) is unchanged
 *   - only metadata (never entry body text) is ever logged, success or
 *     failure
 *   - the aggregate summary threads through the wired reactive streak
 *     view's longestStreak, and is scoped to only the entries the current
 *     identity may export
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { unzipSync, strFromU8 } from 'fflate'
import type { Observable } from '@legendapp/state'
import type { DailyEntryView } from 'app/state/types'
import type { StreakState } from 'app/state/streak'

// ─── Controlled mock state ─────────────────────────────────────────────────
// `mock`-prefixed per Vitest's hoisting rules, so it may be referenced
// inside the vi.mock factories below despite vi.mock calls being hoisted
// above these declarations.
let mockEntries: DailyEntryView[] = []
const mockDownloadExport = vi.fn().mockResolvedValue(undefined)

// ─── @my/ui — minimal passthrough preserving testID/onPress/onChangeText ──
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, children, ...rest } = props as Record<string, unknown> & {
      testID?: string
      onPress?: () => void
      children?: unknown
    }
    const out: Record<string, unknown> = { ...rest }
    if (testID) out['data-testid'] = testID
    if (onPress) out.onClick = onPress
    return out
  }

  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      ReactModule.createElement(tag, mapProps(props), children)

  const Input = ({ testID, value, onChangeText }: any) =>
    ReactModule.createElement('input', {
      ...(testID ? { 'data-testid': testID } : {}),
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
    })

  return {
    Circle: passthrough('span'),
    Input,
    Text: passthrough('span'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

// ─── app/state/store — local mock (own copy, not shared with SettingsScreen
// tests) exposing views.allEntriesSorted + views.streak + session.userId.
//
// `use$`/@legendapp/state/react is left UNMOCKED (same rationale as
// HomeScreen.collective-gate.test.tsx): the real hook must react to
// `.set()` calls made from the test body, which only works if the
// observables come from the SAME @legendapp/state module instance the app
// code uses — built here via `vi.importActual` inside the async factory.
vi.mock('app/state/store', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const userId$ = observable<string | null>(null)
  const streak$ = observable({
    currentStreak: 0,
    longestStreak: 0,
    unlockTokensEarned: 0,
    unlockedThemes: [],
    nextUnlockMilestone: null as number | null,
    lastQualifyingDate: null as string | null,
  })
  return {
    store$: {
      session: {
        userId: userId$,
      },
      views: {
        // Mirrors the real store$.views.allEntriesSorted shape: a plain
        // function returning a plain array (not itself observable) — see
        // packages/app/state/store.ts.
        allEntriesSorted: () => mockEntries,
        streak: streak$,
      },
    },
  }
})

// downloadExport is the carryover delivery seam — mocked so tests never
// touch a real DOM anchor/URL.createObjectURL, and so calls can be
// inspected (filename, blob) and made to fail on demand.
vi.mock('app/utils/downloadExport', () => ({
  downloadExport: (...args: unknown[]) => mockDownloadExport(...args),
}))

// ─── Import under test (real component + real formatter) ──────────────────
import { ExportJournal } from '../ExportJournal'
import { store$ } from 'app/state/store'

const userId$ = store$.session.userId
// The real store$.views.streak is typed as a Legend-State "computed getter"
// (see app/state/streak.ts), which TypeScript sees as a callable + observable
// intersection even though this module is mocked at runtime. Cast to the
// plain Observable<StreakState> shape the mock actually constructs.
const streak$ = store$.views.streak as unknown as Observable<StreakState>

const baseStreak = {
  currentStreak: 0,
  longestStreak: 0,
  unlockTokensEarned: 0,
  unlockedThemes: [],
  nextUnlockMilestone: null as number | null,
  lastQualifyingDate: null as string | null,
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeEntry(
  date: string,
  userId: string | null,
  flows: { time: string; content: string; words: number }[]
): DailyEntryView {
  return {
    id: `entry-${date}`,
    entryDate: date,
    lastModified: new Date().toISOString(),
    user_id: userId,
    flows: flows.map((f, i) => ({
      id: `flow-${date}-${i}`,
      dailyEntryId: `entry-${date}`,
      timestamp: `${date}T${f.time}:00.000Z`,
      content: f.content,
      wordCount: f.words,
      user_id: userId,
      local_session_id: 'test-session',
    })),
    totalWords: flows.reduce((s, f) => s + f.words, 0),
  }
}

function makeOwnedEntry(
  date: string,
  userId: string | null,
  content: string,
  words: number
): DailyEntryView {
  return makeEntry(date, userId, [{ time: '10:00', content, words }])
}

function makeManyEntries(count: number, userId: string | null): DailyEntryView[] {
  const base = new Date('2020-01-01T00:00:00.000Z')
  const out: DailyEntryView[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 86_400_000)
    const dateStr = d.toISOString().slice(0, 10)
    out.push(
      makeEntry(dateStr, userId, [
        { time: '09:00', content: `Synthetic entry ${i} body text`, words: 5 },
      ])
    )
  }
  return out
}

function openAndExportAll() {
  fireEvent.click(screen.getByTestId('export-journal-open'))
  fireEvent.click(screen.getByTestId('export-all'))
}

async function runAllExportTimers() {
  await act(async () => {
    await vi.runAllTimersAsync()
  })
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mockEntries = []
  mockDownloadExport.mockReset().mockResolvedValue(undefined)
  act(() => {
    userId$.set(null)
    streak$.set(baseStreak)
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ─────────────────────────────────────────────────────────────────────────────
// Calm live progress, no spinner (replaces the old static message)
// ─────────────────────────────────────────────────────────────────────────────

describe('progress during a large export', () => {
  it('shows live "N of M" progress text (N < total observed mid-export) and never renders a spinner', async () => {
    vi.useFakeTimers()
    mockEntries = makeManyEntries(150, 'user-1')
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    openAndExportAll()

    let sawMidProgress = false
    for (let i = 0; i < 80; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5)
      })
      const match = screen.queryByText(/Exporting \d+ of \d+ entries/)
      if (match) {
        const parsed = match.textContent?.match(/Exporting (\d+) of (\d+) entries/)
        if (parsed && Number(parsed[1]) < Number(parsed[2])) {
          sawMidProgress = true
        }
      }
      if (screen.queryByTestId('export-done-reset')) break
    }

    expect(sawMidProgress).toBe(true)
    expect(screen.queryByText('Preparing export...')).toBeNull()
    expect(screen.getByTestId('export-done-reset')).toBeTruthy()

    // No spinner/activity-indicator anywhere across the exporting → done lifecycle.
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
    expect(document.querySelector('[data-testid*="spinner" i]')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('completes small exports without needing multiple progress steps (one frame is enough)', async () => {
    vi.useFakeTimers()
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', 'Quick note', 2)]
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(screen.getByTestId('export-done-reset')).toBeTruthy()
    expect(screen.getByText('Exported 1 entry.')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Client-side only — no network call added
// ─────────────────────────────────────────────────────────────────────────────

describe('client-side export (no network)', () => {
  it('never makes a network request while exporting', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', 'Local only content', 2)]
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(fetchSpy).not.toHaveBeenCalled()
    globalThis.fetch = originalFetch
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Anonymous (signed-out) export, no auth required
// ─────────────────────────────────────────────────────────────────────────────

describe('anonymous export', () => {
  it("lets a signed-out user export local-only entries, excluding a previous account's data, with no auth", async () => {
    vi.useFakeTimers()
    mockEntries = [
      makeOwnedEntry('2026-04-08', null, 'Anonymous local content here', 3),
      makeOwnedEntry('2026-04-09', 'someone-elses-account', 'Foreign account content', 4),
    ]
    act(() => userId$.set(null))

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(screen.getByText('Exported 1 entry.')).toBeTruthy()

    expect(mockDownloadExport).toHaveBeenCalledTimes(1)
    const [blob] = mockDownloadExport.mock.calls[0] as [Blob, string]
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const allText = Object.values(files)
      .map((u) => strFromU8(u))
      .join('\n')

    expect(allText).toContain('Anonymous local content here')
    expect(allText).not.toContain('Foreign account content')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Already-decrypted view is exported verbatim (no separate decryption path)
// ─────────────────────────────────────────────────────────────────────────────

describe('already-decrypted plaintext passthrough', () => {
  it('exports the plaintext content it reads from the store view unchanged, with no extra transformation', async () => {
    vi.useFakeTimers()
    const distinctive = 'ZzQ-plaintext-marker-from-already-decrypted-view-8f2c'
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', distinctive, 3)]
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    const [blob] = mockDownloadExport.mock.calls[0] as [Blob, string]
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const allText = Object.values(files)
      .map((u) => strFromU8(u))
      .join('\n')
    expect(allText).toContain(distinctive)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Delivery seam preserved (unchanged filenames, still goes through downloadExport)
// ─────────────────────────────────────────────────────────────────────────────

describe('delivery seam is preserved', () => {
  it('downloads a ZIP named river-journal-export.zip by default', async () => {
    vi.useFakeTimers()
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', 'Content', 1)]
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(mockDownloadExport).toHaveBeenCalledTimes(1)
    const [, filename] = mockDownloadExport.mock.calls[0] as [Blob, string]
    expect(filename).toBe('river-journal-export.zip')
  })

  it('downloads a single .md file named river-journal-export.md when single-file format is selected', async () => {
    vi.useFakeTimers()
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', 'Content', 1)]
    act(() => userId$.set('user-1'))

    render(React.createElement(ExportJournal))
    fireEvent.click(screen.getByTestId('export-journal-open'))
    fireEvent.click(screen.getByTestId('export-format-single'))
    fireEvent.click(screen.getByTestId('export-all'))
    await runAllExportTimers()

    expect(mockDownloadExport).toHaveBeenCalledTimes(1)
    const [, filename] = mockDownloadExport.mock.calls[0] as [Blob, string]
    expect(filename).toBe('river-journal-export.md')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Metadata-only logging
// ─────────────────────────────────────────────────────────────────────────────

describe('metadata-only logging', () => {
  it('never logs entry body text on a successful export', async () => {
    vi.useFakeTimers()
    const secret = 'MySecretDiaryContentXYZ'
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', secret, 3)]
    act(() => userId$.set('user-1'))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    const loggedArgs = [...logSpy.mock.calls, ...infoSpy.mock.calls]
      .flat()
      .map((a) => JSON.stringify(a))
    for (const arg of loggedArgs) {
      expect(arg).not.toContain(secret)
    }

    logSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('never lets a thrown export error carry entry body text into console.error', async () => {
    vi.useFakeTimers()
    const secret = 'AnotherSecretDiaryEntryBody'
    mockEntries = [makeOwnedEntry('2026-04-08', 'user-1', secret, 3)]
    act(() => userId$.set('user-1'))
    mockDownloadExport.mockRejectedValueOnce(new Error('disk write failed'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(screen.getByText('Export failed. Please try again.')).toBeTruthy()
    expect(errorSpy).toHaveBeenCalled()

    const loggedArgs = errorSpy.mock.calls
      .flat()
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : JSON.stringify(a)))
    for (const arg of loggedArgs) {
      expect(arg).not.toContain(secret)
    }

    errorSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate summary: sourced from the wired streak view, scoped to the
// current identity's exportable entries
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregate summary wiring', () => {
  it('includes the longest streak from the wired reactive streak view in the exported summary', async () => {
    vi.useFakeTimers()
    mockEntries = [
      makeOwnedEntry('2026-04-08', 'user-1', 'Day one', 2),
      makeOwnedEntry('2026-04-09', 'user-1', 'Day two', 3),
    ]
    act(() => {
      userId$.set('user-1')
      streak$.set({ ...baseStreak, currentStreak: 4, longestStreak: 17 })
    })

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    const [blob] = mockDownloadExport.mock.calls[0] as [Blob, string]
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const summaryFile = files['000-summary.md']
    expect(summaryFile).toBeTruthy()
    expect(strFromU8(summaryFile!)).toContain('17')
  })

  it('scopes the summary totals to only the entries the current identity may export', async () => {
    vi.useFakeTimers()
    mockEntries = [
      makeOwnedEntry('2026-04-08', 'user-B', 'Mine one', 3),
      makeOwnedEntry('2026-04-09', 'user-B', 'Mine two', 5),
      makeOwnedEntry('2026-04-10', 'user-A', 'Not mine', 100),
    ]
    act(() => {
      userId$.set('user-B')
      streak$.set({ ...baseStreak, longestStreak: 3 })
    })

    render(React.createElement(ExportJournal))
    openAndExportAll()
    await runAllExportTimers()

    expect(screen.getByText('Exported 2 entries.')).toBeTruthy()

    const [blob] = mockDownloadExport.mock.calls[0] as [Blob, string]
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const allText = Object.values(files)
      .map((u) => strFromU8(u))
      .join('\n')
    expect(allText).not.toContain('Not mine')

    const summaryText = strFromU8(files['000-summary.md']!)
    expect(summaryText).toContain('8') // 3 + 5 words, only user-B's entries
  })
})
