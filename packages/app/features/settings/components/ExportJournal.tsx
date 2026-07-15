import { useState, useMemo, useCallback, useRef } from 'react'
import { Circle, Input, Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import {
  exportJournalChunked,
  exportJournalSingleFileChunked,
  computeExportSummary,
  filterExportableEntries,
  getAvailableMonths,
  DEFAULT_EXPORT_OPTIONS,
} from 'app/utils/exportJournal'
import type { ExportOptions } from 'app/utils/exportJournal'
import type { StreakState } from 'app/state/streak'
import { downloadExport } from 'app/utils/downloadExport'

type ExportMode = 'idle' | 'options' | 'select-months' | 'exporting' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function OptionLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={11}
      textTransform="uppercase"
      letterSpacing={2}
      color="$color8"
      marginTop="$3"
      marginBottom="$1"
    >
      {children}
    </Text>
  )
}

function RadioRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string
  selected: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <XStack
      testID={testID}
      alignItems="center"
      gap="$3"
      cursor="pointer"
      onPress={onPress}
      hoverStyle={{ opacity: 0.8 }}
      pressStyle={{ opacity: 0.7 }}
    >
      <Circle
        size={10}
        borderWidth={1}
        borderColor="$color5"
        backgroundColor={selected ? '$color' : 'transparent'}
      />
      <Text
        fontFamily="$body"
        fontSize={13}
        color={selected ? '$color' : '$color8'}
      >
        {label}
      </Text>
    </XStack>
  )
}

function CheckboxRow({
  label,
  checked,
  onPress,
  testID,
}: {
  label: string
  checked: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <Text
      testID={testID}
      fontFamily="$body"
      fontSize={13}
      color={checked ? '$color' : '$color8'}
      cursor="pointer"
      hoverStyle={{ color: '$color' }}
      onPress={onPress}
    >
      {checked ? '☑' : '☐'} {label}
    </Text>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExportJournal() {
  const allEntriesUnfiltered = use$(store$.views.allEntriesSorted())
  const currentUserId = use$(store$.session.userId)
  // Longest streak comes from the wired, current-user-scoped streak view — the
  // single source of truth (never recomputed inline). It matches the same
  // per-identity scoping as filterExportableEntries, so the exported summary's
  // streak lines up with the exported set's owner.
  const streak = use$(store$.views.streak!) as unknown as StreakState | undefined
  const longestStreak = streak?.longestStreak ?? 0
  // Cross-user defense: local data from a previous account survives sign-out
  // by design (the PreviousAccountBanner owns the delete/keep decision), so
  // export is restricted to the current identity's entries + anonymous local
  // data. Without this, user B could export user A's plaintext journal right
  // after signing in. See spec-fix-cross-user-data-defense.md.
  const allEntries = useMemo(
    () => filterExportableEntries(allEntriesUnfiltered, currentUserId ?? null),
    [allEntriesUnfiltered, currentUserId]
  )
  const [mode, setMode] = useState<ExportMode>('idle')
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set())
  const [exportedCount, setExportedCount] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS)
  const exportingRef = useRef(false)

  const availableMonths = useMemo(() => getAvailableMonths(allEntries), [allEntries])
  const hasEntries = allEntries.length > 0

  // --- Option setters ---

  const setOption = useCallback(
    <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  // --- Month selection ---

  const toggleMonth = useCallback((key: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedMonths((prev) => {
      if (prev.size === availableMonths.length) return new Set()
      return new Set(availableMonths.map((m) => m.key))
    })
  }, [availableMonths])

  // --- Export handlers ---

  const runExport = useCallback(
    async (entries: typeof allEntries) => {
      if (exportingRef.current) return
      if (entries.length === 0) return
      exportingRef.current = true
      setProgress({ done: 0, total: entries.length })
      setMode('exporting')
      const startedAt = Date.now()
      try {
        const isZip = options.fileFormat === 'zip'
        const onProgress = (done: number, total: number) => setProgress({ done, total })
        const blob = isZip
          ? await exportJournalChunked(entries, options, longestStreak, onProgress)
          : await exportJournalSingleFileChunked(entries, options, longestStreak, onProgress)
        const filename = isZip
          ? 'river-journal-export.zip'
          : 'river-journal-export.md'
        await downloadExport(blob, filename)
        setExportedCount(entries.length)
        // Metadata-only success log: counts + duration, never body/email/name.
        const summary = computeExportSummary(entries, longestStreak)
        console.log('[ExportJournal] export complete', {
          entries: summary.totalEntries,
          flows: summary.totalFlows,
          words: summary.totalWords,
          durationMs: Date.now() - startedAt,
        })
        setMode('done')
      } catch (err) {
        // Log only the error message (never the raw error object / stack), so a
        // thrown value can't smuggle entry body content into the log.
        console.error(
          '[ExportJournal] export failed:',
          err instanceof Error ? err.message : 'unknown error'
        )
        setErrorMessage('Something went wrong while preparing your export.')
        setMode('error')
      } finally {
        exportingRef.current = false
      }
    },
    [options, longestStreak]
  )

  const handleExportAll = useCallback(() => {
    runExport(allEntries)
  }, [allEntries, runExport])

  const handleExportSelected = useCallback(() => {
    const filtered = allEntries.filter((e) =>
      selectedMonths.has(e.entryDate.slice(0, 7))
    )
    runExport(filtered)
  }, [allEntries, selectedMonths, runExport])

  const handleReset = useCallback(() => {
    setMode('options')
    setSelectedMonths(new Set())
    setExportedCount(0)
    setErrorMessage(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (!hasEntries) {
    return (
      <YStack gap="$2">
        <Text fontFamily="$journal" fontSize={20} color="$color8">
          Export Journal
        </Text>
        <Text fontFamily="$body" fontSize={13} color="$color8">
          No journal entries to export.
        </Text>
      </YStack>
    )
  }

  if (mode === 'exporting') {
    return (
      <YStack gap="$2">
        <Text fontFamily="$journal" fontSize={20} color="$color">
          Export Journal
        </Text>
        <Text testID="export-progress" fontFamily="$body" fontSize={13} color="$color8">
          Exporting {progress.done} of {progress.total} entries…
        </Text>
      </YStack>
    )
  }

  if (mode === 'error') {
    return (
      <YStack gap="$2">
        <Text fontFamily="$journal" fontSize={20} color="$color">
          Export Journal
        </Text>
        <Text fontFamily="$body" fontSize={13} color="$color8">
          Export failed. Please try again.
        </Text>
        {errorMessage && (
          <Text
            testID="export-error-detail"
            fontFamily="$body"
            fontSize={12}
            color="$color"
            marginTop="$1"
          >
            {errorMessage}
          </Text>
        )}
        <Text
          fontFamily="$body"
          fontSize={11}
          letterSpacing={2}
          textTransform="uppercase"
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={handleReset}
          alignSelf="flex-start"
          marginTop="$1"
        >
          Try Again
        </Text>
      </YStack>
    )
  }

  if (mode === 'done') {
    return (
      <YStack gap="$2">
        <Text fontFamily="$journal" fontSize={20} color="$color">
          Export Journal
        </Text>
        <Text fontFamily="$body" fontSize={13} color="$color8">
          Exported {exportedCount} {exportedCount === 1 ? 'entry' : 'entries'}.
        </Text>
        <Text
          testID="export-done-reset"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={2}
          textTransform="uppercase"
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={handleReset}
          alignSelf="flex-start"
          marginTop="$1"
        >
          Export Again
        </Text>
      </YStack>
    )
  }

  if (mode === 'select-months') {
    const allSelected = selectedMonths.size === availableMonths.length

    return (
      <YStack gap="$3">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontFamily="$journal" fontSize={20} color="$color">
            Select Months
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$color8"
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={() => setMode('options')}
          >
            Cancel
          </Text>
        </XStack>

        <Text
          testID="export-select-all"
          fontFamily="$body"
          fontSize={13}
          color={allSelected ? '$color' : '$color8'}
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={toggleAll}
        >
          {allSelected ? '☑ All Months' : '☐ Select All'}
        </Text>

        <YStack gap="$2">
          {availableMonths.map((m) => {
            const isSelected = selectedMonths.has(m.key)
            return (
              <Text
                key={m.key}
                testID={`export-month-${m.key}`}
                fontFamily="$body"
                fontSize={13}
                color={isSelected ? '$color' : '$color8'}
                cursor="pointer"
                hoverStyle={{ color: '$color' }}
                onPress={() => toggleMonth(m.key)}
              >
                {isSelected ? '☑' : '☐'} {m.label}
              </Text>
            )
          })}
        </YStack>

        {selectedMonths.size > 0 && (
          <Text
            testID="export-selected-confirm"
            fontFamily="$body"
            fontSize={11}
            letterSpacing={3}
            fontWeight="500"
            textTransform="uppercase"
            color="$color"
            borderBottomWidth={2}
            borderColor="$color10"
            paddingBottom={6}
            alignSelf="flex-start"
            marginTop="$1"
            cursor="pointer"
            hoverStyle={{ opacity: 0.7 }}
            onPress={handleExportSelected}
          >
            Export {selectedMonths.size} {selectedMonths.size === 1 ? 'Month' : 'Months'}
          </Text>
        )}
      </YStack>
    )
  }

  // ---------------------------------------------------------------------------
  // Idle mode — just the entry point
  // ---------------------------------------------------------------------------

  if (mode === 'idle') {
    return (
      <YStack gap="$2">
        <Text
          testID="export-journal-open"
          fontFamily="$journal"
          fontSize={20}
          color="$color"
          cursor="pointer"
          hoverStyle={{ opacity: 0.7 }}
          onPress={() => setMode('options')}
        >
          Export Journal
        </Text>
        <Text fontFamily="$body" fontSize={13} color="$color8">
          Download your entries as Markdown files.
        </Text>
      </YStack>
    )
  }

  // ---------------------------------------------------------------------------
  // Options mode — format, toggles, export buttons
  // ---------------------------------------------------------------------------

  return (
    <YStack gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontFamily="$journal" fontSize={20} color="$color">
          Export Journal
        </Text>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={() => setMode('idle')}
        >
          Cancel
        </Text>
      </XStack>

      {/* Format */}
      <OptionLabel>Format</OptionLabel>
      <YStack gap="$2">
        <RadioRow
          testID="export-format-zip"
          label="Separate files (ZIP)"
          selected={options.fileFormat === 'zip'}
          onPress={() => setOption('fileFormat', 'zip')}
        />
        <RadioRow
          testID="export-format-single"
          label="Single file (.md)"
          selected={options.fileFormat === 'single-file'}
          onPress={() => setOption('fileFormat', 'single-file')}
        />
      </YStack>

      {/* Options */}
      <OptionLabel>Options</OptionLabel>
      <YStack gap="$2">
        <CheckboxRow
          testID="export-opt-headings"
          label="Time headings"
          checked={options.showTimeHeadings}
          onPress={() => setOption('showTimeHeadings', !options.showTimeHeadings)}
        />
        <CheckboxRow
          testID="export-opt-separators"
          label="Flow separators"
          checked={options.showSeparators}
          onPress={() => setOption('showSeparators', !options.showSeparators)}
        />
        {options.showSeparators && (
          <XStack alignItems="center" gap="$2" paddingLeft="$4">
            <Text fontFamily="$body" fontSize={13} color="$color8">
              Separator:
            </Text>
            <Input
              testID="export-separator-input"
              value={options.separatorText}
              onChangeText={(text: string) => setOption('separatorText', text)}
              fontFamily="$body"
              fontSize={13}
              maxLength={80}
              width={120}
              paddingVertical="$1"
              paddingHorizontal="$2"
              borderColor="$color5"
              color="$color"
            />
          </XStack>
        )}
        {options.fileFormat === 'zip' && (
          <CheckboxRow
            testID="export-opt-frontmatter"
            label="Metadata (date, word count)"
            checked={options.showFrontmatter}
            onPress={() => setOption('showFrontmatter', !options.showFrontmatter)}
          />
        )}
      </YStack>

      {/* Export buttons */}
      <XStack gap="$4" marginTop="$3" flexWrap="wrap">
        <Text
          testID="export-all"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={3}
          fontWeight="500"
          textTransform="uppercase"
          color="$color"
          borderBottomWidth={2}
          borderColor="$color10"
          paddingBottom={6}
          cursor="pointer"
          hoverStyle={{ opacity: 0.7 }}
          onPress={handleExportAll}
        >
          Export All
        </Text>
        <Text
          testID="export-select-months"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={3}
          fontWeight="500"
          textTransform="uppercase"
          color="$color"
          borderBottomWidth={2}
          borderColor="$color10"
          paddingBottom={6}
          cursor="pointer"
          hoverStyle={{ opacity: 0.7 }}
          onPress={() => setMode('select-months')}
        >
          Select Months
        </Text>
      </XStack>
    </YStack>
  )
}
