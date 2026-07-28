import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform } from 'react-native'
import { useDebounce } from 'use-debounce'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { use$ } from '@legendapp/state/react'
import { ExpandingLineButton, Input, Text, View, XStack, YStack } from '@my/ui'
import { store$ } from 'app/state/store'
import type { DailyEntryView } from 'app/state/types'
import { filterExportableEntries } from 'app/utils/exportJournal'
import { Editor } from 'app/features/journal/components/Editor'
import { searchFlows } from 'app/state/search'
import type { SearchResultRow } from 'app/state/search'
import { joinFlowsForReader } from './joinFlowsForReader'

// Debounce window matching the editor→store convention: the query only drives a
// search 300ms after typing settles.
const SEARCH_DEBOUNCE_MS = 300

// The focus-search shortcut is registered locally (not through the global nav
// hotkey registry) because the input only exists on this surface. A leading
// slash is the search-conventional chord and does not collide with the browser
// find shortcut (Mod+F), which stays available.
const FOCUS_SEARCH_HOTKEY = '/'

const SEARCH_LABEL = 'Search past entries'

function formatReaderDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// A single result row: date, snippet with the match emphasized, and the day's
// flow count. Rendered as a focusable, keyboard-activatable pressable.
// ─────────────────────────────────────────────────────────────────────────────
interface ResultRowProps {
  row: SearchResultRow
  onOpen: (entryDate: string) => void
}

function ResultRow({ row, onOpen }: ResultRowProps) {
  const pre = row.snippet.slice(0, row.matchStart)
  const match = row.snippet.slice(row.matchStart, row.matchStart + row.matchLength)
  const post = row.snippet.slice(row.matchStart + row.matchLength)
  const flowLabel = `${row.flowCount} ${row.flowCount === 1 ? 'flow' : 'flows'}`

  const activate = () => onOpen(row.entryDate)

  return (
    <YStack
      testID="search-result-row"
      {...({ role: 'button', tabIndex: 0 } as any)}
      onPress={activate}
      onKeyDown={(event: any) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault?.()
          activate()
        }
      }}
      gap="$1"
      paddingVertical="$3"
      paddingHorizontal="$2"
      cursor="pointer"
      borderRadius="$2"
      hoverStyle={{ backgroundColor: '$color2' }}
      focusStyle={{
        backgroundColor: '$color3',
        outlineColor: '$color',
        outlineWidth: 2,
        outlineStyle: 'solid',
      }}
    >
      <XStack
        justifyContent="space-between"
        alignItems="baseline"
        gap="$3"
      >
        <Text
          fontFamily="$body"
          fontSize={14}
          color="$color8"
          letterSpacing={0.5}
        >
          {formatReaderDate(row.entryDate)}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$color7"
        >
          {flowLabel}
        </Text>
      </XStack>
      <Text
        fontFamily="$journal"
        fontSize={18}
        color="$color"
        lineHeight={28}
      >
        <Text color="$color">{pre}</Text>
        <Text
          fontWeight="700"
          color="$color"
        >
          {match}
        </Text>
        <Text color="$color">{post}</Text>
      </Text>
    </YStack>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PastEntriesSearch
//
// Renders the search affordance (web/desktop: an always-visible inline input;
// mobile: a header affordance that reveals/focuses the input) plus a
// synchronous results region. When a query of >= 2 characters (after a 300ms
// debounce) is active, it renders results in place of `children` (the normal
// Linear/Calendar views); otherwise it renders `children` unchanged.
// ─────────────────────────────────────────────────────────────────────────────
interface PastEntriesSearchProps {
  entries: DailyEntryView[]
  children?: ReactNode
}

export function PastEntriesSearch({ entries, children }: PastEntriesSearchProps) {
  const isWeb = Platform.OS === 'web'
  const currentUserId = use$(store$.session.userId)

  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState(isWeb)
  const [openEntryDate, setOpenEntryDate] = useState<string | null>(null)

  const inputRef = useRef<any>(null)
  const shouldFocusOnReveal = useRef(false)

  // 300ms debounce of the raw query, matching the editor→store convention.
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_MS)

  const trimmedQuery = debouncedQuery.trim()
  const active = trimmedQuery.length >= 2

  const results = useMemo(
    () => searchFlows(entries, debouncedQuery, currentUserId ?? null),
    [entries, debouncedQuery, currentUserId]
  )

  // Ownership-filtered pool, used to resolve a result row back to its day's
  // flows for the read-only reader — the same filter the search itself applies.
  const ownedEntries = useMemo(
    () => filterExportableEntries(entries, currentUserId ?? null),
    [entries, currentUserId]
  )

  const openEntry = openEntryDate
    ? ownedEntries.find((entry) => entry.entryDate === openEntryDate)
    : undefined

  const focusSearchInput = () => {
    const node = inputRef.current
    if (node && typeof node.focus === 'function') {
      node.focus()
      return
    }
    if (typeof document !== 'undefined') {
      const el = document.querySelector('[data-testid="search-input"]') as HTMLElement | null
      el?.focus()
    }
  }

  // Focus the input once it has actually been revealed (mobile affordance path).
  useEffect(() => {
    if (revealed && shouldFocusOnReveal.current) {
      shouldFocusOnReveal.current = false
      focusSearchInput()
    }
  }, [revealed])

  const revealAndFocus = () => {
    shouldFocusOnReveal.current = true
    if (revealed) {
      focusSearchInput()
    } else {
      setRevealed(true)
    }
  }

  // Web/desktop focus-search shortcut, scoped to this surface. Registered on
  // web only; on native there is no `document` target so the registration is a
  // no-op. Follows the suppression conventions used by the nav shortcuts.
  useHotkeys(
    [
      {
        hotkey: FOCUS_SEARCH_HOTKEY,
        callback: (event: KeyboardEvent) => {
          if (event.isComposing || event.keyCode === 229) return
          if (event.defaultPrevented) return
          event.preventDefault()
          focusSearchInput()
        },
        options: { ignoreInputs: true, preventDefault: false },
      },
    ],
    { stopPropagation: false, enabled: typeof window !== 'undefined' && isWeb }
  )

  const showInput = isWeb || revealed

  return (
    <YStack gap="$4">
      {!isWeb && (
        <XStack>
          <ExpandingLineButton
            testID="search-affordance-button"
            accessibilityLabel={SEARCH_LABEL}
            onPress={revealAndFocus}
          >
            Search
          </ExpandingLineButton>
        </XStack>
      )}

      {showInput && (
        <Input
          ref={inputRef}
          testID="search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={SEARCH_LABEL}
          autoCapitalize="none"
          autoCorrect={false}
          {...({ 'aria-label': SEARCH_LABEL } as any)}
          fontFamily="$journal"
          fontSize={18}
          color="$color"
          placeholderTextColor="$color6"
          backgroundColor="transparent"
          borderWidth={0}
          borderBottomWidth={1}
          borderColor="$color3"
          borderRadius={0}
          paddingHorizontal={0}
          paddingVertical="$2"
          focusStyle={{ borderColor: '$color' }}
        />
      )}

      {active ? (
        <YStack gap="$4">
          {results.length > 0 ? (
            <YStack testID="search-results">
              {results.map((row) => (
                <View key={row.entryDate}>
                  <ResultRow
                    row={row}
                    onOpen={setOpenEntryDate}
                  />
                </View>
              ))}
            </YStack>
          ) : (
            <YStack
              testID="search-empty-state"
              paddingVertical="$6"
              alignItems="center"
            >
              <Text
                fontFamily="$journal"
                fontSize={18}
                color="$color8"
                fontStyle="italic"
              >
                No entries match that search yet.
              </Text>
            </YStack>
          )}

          {openEntry && (
            <YStack
              marginTop="$2"
              gap="$3"
            >
              <XStack
                justifyContent="space-between"
                alignItems="center"
              >
                <Text
                  fontFamily="$journalItalic"
                  fontStyle="italic"
                  fontSize="$5"
                  color="$color"
                >
                  {formatReaderDate(openEntry.entryDate)}
                </Text>
                <ExpandingLineButton
                  accessibilityLabel="Close"
                  onPress={() => setOpenEntryDate(null)}
                >
                  Close
                </ExpandingLineButton>
              </XStack>
              <Editor
                readOnly
                initialContent={joinFlowsForReader(openEntry.flows)}
              />
            </YStack>
          )}
        </YStack>
      ) : (
        children
      )}
    </YStack>
  )
}
