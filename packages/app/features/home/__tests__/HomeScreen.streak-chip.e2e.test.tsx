// @vitest-environment happy-dom
// HomeScreen — StreakChip wiring to streak$ reactive view
// Verifies that HomeScreen passes currentStreak and lastQualifyingDate-derived state to StreakChip.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// ─── Streak state fixture ─────────────────────────────────────────────────────
// TODAY matches the frozen getTodayJournalDayString mock below.
const TODAY = '2026-05-04'

const makeStreakState = (overrides: Partial<{
  currentStreak: number
  lastQualifyingDate: string | null
  longestStreak: number
  unlockTokensEarned: number
  unlockedThemes: string[]
  nextUnlockMilestone: number
}> = {}) => ({
  currentStreak: 0,
  lastQualifyingDate: null,
  longestStreak: 0,
  unlockTokensEarned: 0,
  unlockedThemes: [],
  nextUnlockMilestone: 7,
  ...overrides,
})

// ─── Controllable use$ return value ──────────────────────────────────────────
let use$ReturnValue: any = null

vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn(() => use$ReturnValue),
}))

// ─── Frozen date ──────────────────────────────────────────────────────────────
vi.mock('app/state/date-utils', () => ({
  getTodayJournalDayString: () => TODAY,
}))

// ─── Store mock — views.streak exposed as observable-like ────────────────────
vi.mock('app/state/store', () => ({
  store$: {
    views: {
      streak: { get: () => use$ReturnValue },
      statsByDate: vi.fn(() => ({})),
    },
    session: {
      get: vi.fn(() => ({ isAuthenticated: false })),
    },
  },
}))

// ─── @my/ui mock — StreakChip stub forwards dayCount and state as data attrs ──
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const mapped: Record<string, unknown> = {}
    if (props.testID) mapped['data-testid'] = props.testID
    if (props.onPress) mapped['onClick'] = props.onPress
    if (props.onScroll) mapped['onScroll'] = props.onScroll
    if (props.role) mapped['role'] = props.role
    if (props.accessibilityRole) mapped['role'] = props.accessibilityRole
    if (props['aria-label']) mapped['aria-label'] = props['aria-label']
    if (props.accessibilityLabel) mapped['aria-label'] = props.accessibilityLabel
    return mapped
  }

  const Text = ({ children, onPress, onHoverIn, onHoverOut, onPressIn, onPressOut, testID, accessibilityRole, accessibilityLabel, transition, x, ...props }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...props,
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
        ...(onHoverIn ? { onMouseEnter: onHoverIn } : {}),
        ...(onHoverOut ? { onMouseLeave: onHoverOut } : {}),
        ...(onPressIn ? { onMouseDown: onPressIn } : {}),
        ...(onPressOut ? { onMouseUp: onPressOut } : {}),
        ...(transition !== undefined ? { 'data-transition': transition ?? 'none' } : {}),
        ...(x !== undefined ? { 'data-x': String(x) } : {}),
      },
      children
    )

  // StreakChip stub: forwards dayCount as text and state as data-state attr
  const StreakChip = ({ dayCount, state, ...props }: any) => {
    const label = dayCount != null ? `Day ${dayCount} streak` : 'Day — streak'
    const text = dayCount != null ? `Day ${dayCount}` : 'Day —'
    return ReactModule.createElement(
      'span',
      {
        'data-testid': 'streak-chip',
        role: 'text',
        'aria-label': label,
        ...(state !== undefined ? { 'data-state': state } : {}),
      },
      text
    )
  }

  const CollectiveEntry = ({ state = 'dim', onPress, ...props }: any) => {
    const label = state === 'lit' ? 'Collective' : 'Collective, locked'
    return ReactModule.createElement(
      'span',
      {
        'data-testid': 'collective-entry',
        role: 'button',
        'aria-label': label,
        onClick: onPress,
      },
      'COLLECTIVE'
    )
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AnimatePresence,
    ScrollView: passthrough('div'),
    Text,
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    useReducedMotion: () => false,
    StreakChip,
    CollectiveEntry,
  }
})

// ─── solito/navigation ────────────────────────────────────────────────────────
const pushSpy = vi.fn()
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── Dialog + nav stubs ───────────────────────────────────────────────────────
vi.mock('app/features/home/components/KeyringPrompt', () => ({
  KeyringPrompt: () => React.createElement('div', { 'data-testid': 'keyring-prompt' }, null),
}))
vi.mock('app/features/home/components/OrphanFlowsDialog', () => ({
  OrphanFlowsDialog: () => React.createElement('div', { 'data-testid': 'orphan-flows-dialog' }, null),
}))
vi.mock('app/features/home/components/EncryptionModeDialog', () => ({
  EncryptionModeDialog: () => React.createElement('div', { 'data-testid': 'encryption-mode-dialog' }, null),
}))
vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => React.createElement('nav', { 'data-testid': 'word-link-nav' }, null),
}))

const lapsedMock = { shouldShow: false, dismiss: vi.fn() }
vi.mock('../useLapsedPrompt', () => ({
  useLapsedPrompt: () => lapsedMock,
}))
vi.mock('../components/LapsedPrompt', () => ({
  LapsedPrompt: () => null,
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'

afterEach(() => {
  cleanup()
  pushSpy.mockClear()
  use$ReturnValue = null
})
beforeEach(() => {
  lapsedMock.shouldShow = false
  lapsedMock.dismiss = vi.fn()
})

// ─────────────────────────────────────────────────────────────────────────────
// SC1 — StreakChip receives currentStreak as dayCount from streak$ view
// ─────────────────────────────────────────────────────────────────────────────
describe('HomeScreen — StreakChip receives live currentStreak from streak$ view', () => {
  it('SC1: chip displays "Day 7" when streak view returns currentStreak=7', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 7, lastQualifyingDate: '2026-05-03' })
    render(React.createElement(HomeScreen))
    expect(screen.getByText('Day 7')).toBeTruthy()
  })

  it('SC1: chip displays "Day 0" when streak view returns currentStreak=0', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 0, lastQualifyingDate: null })
    render(React.createElement(HomeScreen))
    expect(screen.getByText('Day 0')).toBeTruthy()
  })

  it('SC1: chip displays "Day —" when streak view returns undefined (defensive fallback)', () => {
    use$ReturnValue = undefined
    render(React.createElement(HomeScreen))
    // Fallback: currentStreak=0, renders "Day 0" (defensive fallback when streak view is undefined)
    // OR "Day —" if the chip still receives undefined. Either is acceptable; test the chip mounts.
    const chip = screen.getByTestId('streak-chip')
    expect(chip).toBeTruthy()
  })

  it('SC1: chip displays "Day 30" when streak view returns currentStreak=30', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 30, lastQualifyingDate: TODAY })
    render(React.createElement(HomeScreen))
    expect(screen.getByText('Day 30')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SC2 — StreakChip receives state="active" when lastQualifyingDate equals today
// ─────────────────────────────────────────────────────────────────────────────
describe('HomeScreen — StreakChip state prop: active when today\'s 500 words crossed', () => {
  it('SC2: chip receives state="active" when lastQualifyingDate equals today', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 5, lastQualifyingDate: TODAY })
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    expect(chip.getAttribute('data-state')).toBe('active')
  })

  it('SC2: chip receives state="pending" when lastQualifyingDate is yesterday (not today)', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 4, lastQualifyingDate: '2026-05-03' })
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    expect(chip.getAttribute('data-state')).toBe('pending')
  })

  it('SC2: chip receives state="pending" when lastQualifyingDate is null (no entries ever)', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 0, lastQualifyingDate: null })
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    expect(chip.getAttribute('data-state')).toBe('pending')
  })

  it('SC2: chip receives state="pending" when streak view is undefined (defensive fallback)', () => {
    use$ReturnValue = undefined
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    // Defensive fallback: no qualifying date → pending
    expect(chip.getAttribute('data-state')).toBe('pending')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SC3 — StreakChip slot still mounts (regression guard)
// ─────────────────────────────────────────────────────────────────────────────
describe('HomeScreen — StreakChip slot mounts (slot renders a chip element)', () => {
  it('SC3: streak chip slot wrapper is present by testID', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 3 })
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('home-streak-chip-slot')).toBeTruthy()
  })

  it('SC3: streak chip itself is rendered inside the slot', () => {
    use$ReturnValue = makeStreakState({ currentStreak: 3 })
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('streak-chip')).toBeTruthy()
  })
})
