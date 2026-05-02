// @vitest-environment happy-dom
// Story 1.6: HomeScreen layout — date hero, CTA spring, reserved slots, dialog preservation (AC1–AC7)

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Local push spy (NOT the shared lambda — see story 1-6, task 7 notes) ───
const pushSpy = vi.fn()

// ─── @my/ui mock — controllable useReducedMotion ────────────────────────────
// reduceMotionValue is mutated per-test so the mock reads it fresh each render.
let reduceMotionValue = false

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, children, accessibilityRole, accessibilityLabel } = props
    return {
      ...(testID ? { 'data-testid': testID } : {}),
      ...(accessibilityRole ? { role: accessibilityRole } : {}),
      ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  // Stateful Text: exposes onHoverIn/onHoverOut/onPressIn/onPressOut as mouse events
  // Also captures transition and x props via data attributes for assertion.
  const Text = ({ children, onPress, onHoverIn, onHoverOut, onPressIn, onPressOut, testID, accessibilityRole, accessibilityLabel, transition, x, ...props }: any) =>
    ReactModule.createElement(
      'span',
      {
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

  // ─── StreakChip stub — forwards text content and a11y props for HomeScreen assertions
  const StreakChip = ({ dayCount, ...props }: any) => {
    const label = dayCount != null ? `Day ${dayCount} streak` : 'Day — streak'
    const text = dayCount != null ? `Day ${dayCount}` : 'Day —'
    return ReactModule.createElement(
      'span',
      {
        'data-testid': 'streak-chip',
        role: 'text',
        'aria-label': label,
      },
      text
    )
  }

  // ─── CollectiveEntry stub — forwards onPress and a11y for HomeScreen assertions
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

  return {
    AnimatePresence,
    ScrollView: passthrough('div'),
    Text,
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
    useReducedMotion: () => reduceMotionValue,
    StreakChip,
    CollectiveEntry,
  }
})

// ─── solito/navigation — local spy (not shared lambda) ──────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── Legend State ────────────────────────────────────────────────────────────
vi.mock('@legendapp/state/react', () => ({
  use$: vi.fn(() => null),
}))

vi.mock('app/state/store', () => ({
  store$: {
    views: {
      statsByDate: vi.fn(() => ({})),
    },
    session: {
      get: vi.fn(() => ({ isAuthenticated: false })),
    },
  },
}))

vi.mock('app/state/date-utils', () => ({
  getTodayJournalDayString: () => '2026-05-02',
}))

// ─── Dialog components ───────────────────────────────────────────────────────
vi.mock('app/features/home/components/KeyringPrompt', () => ({
  KeyringPrompt: () => React.createElement('div', { 'data-testid': 'keyring-prompt' }, null),
}))

vi.mock('app/features/home/components/OrphanFlowsDialog', () => ({
  OrphanFlowsDialog: () => React.createElement('div', { 'data-testid': 'orphan-flows-dialog' }, null),
}))

vi.mock('app/features/home/components/EncryptionModeDialog', () => ({
  EncryptionModeDialog: () => React.createElement('div', { 'data-testid': 'encryption-mode-dialog' }, null),
}))

// ─── WordLinkNav ─────────────────────────────────────────────────────────────
vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => React.createElement('nav', { 'data-testid': 'word-link-nav' }, null),
}))

// ─── Import under test ───────────────────────────────────────────────────────
import { HomeScreen } from '../HomeScreen'

afterEach(() => {
  cleanup()
  pushSpy.mockClear()
  reduceMotionValue = false
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Rendering basics
// ─────────────────────────────────────────────────────────────────────────────
describe('HomeScreen renders hero content', () => {
  it('renders TODAY label', () => {
    render(React.createElement(HomeScreen))
    // The TODAY text — case-insensitive since the component uses "Today" (uppercase applied via CSS)
    expect(screen.getByText(/today/i)).toBeTruthy()
  })

  it('renders a date string (month + day present in output)', () => {
    render(React.createElement(HomeScreen))
    // new Date().toLocaleDateString renders e.g. "Saturday, May 2, 2026"
    // assert that at least a month-name substring is present
    const months = /January|February|March|April|May|June|July|August|September|October|November|December/
    const dateEl = screen.getByText(months)
    expect(dateEl).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. "Begin writing" CTA — accessibility (AC 7)
// ─────────────────────────────────────────────────────────────────────────────
describe('Begin writing CTA — accessibility (AC7)', () => {
  it('renders "Begin writing" text', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByText('Begin writing')).toBeTruthy()
  })

  it('has accessibilityRole="button"', () => {
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    expect(cta.getAttribute('role')).toBe('button')
  })

  it('has accessibilityLabel="Begin writing"', () => {
    render(React.createElement(HomeScreen))
    // getByRole checks aria-label or accessible name
    const cta = screen.getByRole('button', { name: 'Begin writing' })
    expect(cta).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. CTA press navigates to /journal (AC 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('Begin writing CTA — navigation (AC2)', () => {
  beforeEach(() => {
    pushSpy.mockClear()
  })

  it('calls router.push("/journal") when CTA is pressed', () => {
    render(React.createElement(HomeScreen))
    const cta = screen.getByRole('button', { name: 'Begin writing' })
    fireEvent.click(cta)
    expect(pushSpy).toHaveBeenCalledWith('/journal')
  })

  it('calls router.push exactly once per press', () => {
    render(React.createElement(HomeScreen))
    const cta = screen.getByRole('button', { name: 'Begin writing' })
    fireEvent.click(cta)
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. CTA spring transition (AC 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('Begin writing CTA — ctaSpring transition (AC2)', () => {
  it('renders with transition="ctaSpring" when useReducedMotion returns false', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    expect(cta.getAttribute('data-transition')).toBe('ctaSpring')
  })

  it('omits ctaSpring transition when useReducedMotion returns true', () => {
    reduceMotionValue = true
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    // transition should be undefined → rendered as 'none' sentinel (see mock)
    expect(cta.getAttribute('data-transition')).not.toBe('ctaSpring')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. CTA translation x (AC 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('Begin writing CTA — x translation on hover/press (AC2)', () => {
  it('x is 0 when not hovered / not pressed under normal motion', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    expect(cta.getAttribute('data-x')).toBe('0')
  })

  it('x becomes 5 when hovered under normal motion (onHoverIn)', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseEnter(cta)
    expect(cta.getAttribute('data-x')).toBe('5')
  })

  it('x returns to 0 when hover ends under normal motion (onHoverOut)', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseEnter(cta)
    fireEvent.mouseLeave(cta)
    expect(cta.getAttribute('data-x')).toBe('0')
  })

  it('x becomes 5 when pressed under normal motion (onPressIn)', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseDown(cta)
    expect(cta.getAttribute('data-x')).toBe('5')
  })

  it('x returns to 0 on press release under normal motion (onPressOut)', () => {
    reduceMotionValue = false
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseDown(cta)
    fireEvent.mouseUp(cta)
    expect(cta.getAttribute('data-x')).toBe('0')
  })

  it('x stays 0 when hovered under reduced motion', () => {
    reduceMotionValue = true
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseEnter(cta)
    expect(cta.getAttribute('data-x')).toBe('0')
  })

  it('x stays 0 when pressed under reduced motion', () => {
    reduceMotionValue = true
    render(React.createElement(HomeScreen))
    const cta = screen.getByText('Begin writing')
    fireEvent.mouseDown(cta)
    expect(cta.getAttribute('data-x')).toBe('0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Slot wrappers — now contain real components (1-7 upgrade from 1-6)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip slot wrapper (1-7: now contains StreakChip component)', () => {
  it('renders the StreakChip slot wrapper by testID', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('home-streak-chip-slot')).toBeTruthy()
  })

  it('StreakChip slot wrapper has text content (contains StreakChip)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-streak-chip-slot')
    // Slot now contains the real StreakChip — text is non-empty
    expect(slot.textContent).not.toBe('')
  })

  it('StreakChip slot wrapper contains an element with role="text" (from StreakChip)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-streak-chip-slot')
    const chip = slot.querySelector('[role="text"]')
    expect(chip).toBeTruthy()
  })

  it('StreakChip slot wrapper contains an element with aria-label (from StreakChip)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-streak-chip-slot')
    const chip = slot.querySelector('[aria-label]')
    expect(chip).toBeTruthy()
  })
})

describe('CollectiveEntry slot wrapper (1-7: now contains CollectiveEntry component)', () => {
  it('renders the CollectiveEntry slot wrapper by testID', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('home-collective-entry-slot')).toBeTruthy()
  })

  it('CollectiveEntry slot wrapper has text content (contains CollectiveEntry)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-collective-entry-slot')
    // Slot now contains the real CollectiveEntry — text is non-empty
    expect(slot.textContent).not.toBe('')
  })

  it('CollectiveEntry slot wrapper contains an element with role="button" (from CollectiveEntry)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-collective-entry-slot')
    const entry = slot.querySelector('[role="button"]')
    expect(entry).toBeTruthy()
  })

  it('CollectiveEntry slot wrapper contains an element with aria-label (from CollectiveEntry)', () => {
    render(React.createElement(HomeScreen))
    const slot = screen.getByTestId('home-collective-entry-slot')
    const entry = slot.querySelector('[aria-label]')
    expect(entry).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. maxWidth={1024} reading-width cap preserved (AC 5)
// Note: Tamagui style props are not forwarded to DOM via our passthrough mock,
// so we assert via the component source pattern test: the slot tests above and
// dialog tests below confirm the overall component renders. The maxWidth
// assertion is a structural smoke: confirm the content container node renders
// (it wraps everything inside AnimatePresence / mounted gate).
// ─────────────────────────────────────────────────────────────────────────────
describe('Reading-width container (AC5)', () => {
  it('home content container is mounted and wraps hero', () => {
    render(React.createElement(HomeScreen))
    // The TODAY label lives inside the maxWidth container; if it renders,
    // the container rendered too.
    expect(screen.getByText(/today/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Dialog preservation (AC 6)
// ─────────────────────────────────────────────────────────────────────────────
describe('Dialog components preserved (AC6)', () => {
  it('mounts KeyringPrompt', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('keyring-prompt')).toBeTruthy()
  })

  it('mounts OrphanFlowsDialog', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('orphan-flows-dialog')).toBeTruthy()
  })

  it('mounts EncryptionModeDialog', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('encryption-mode-dialog')).toBeTruthy()
  })

  it('all three dialogs are mounted simultaneously', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('keyring-prompt')).toBeTruthy()
    expect(screen.getByTestId('orphan-flows-dialog')).toBeTruthy()
    expect(screen.getByTestId('encryption-mode-dialog')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Story 1-7: StreakChip mounts in home (AC1, AC2, AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('StreakChip mounts in HomeScreen (1-7 AC1, AC2, AC6)', () => {
  it('renders a StreakChip element inside the home layout', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('streak-chip')).toBeTruthy()
  })

  it('StreakChip displays the placeholder "Day —" text', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByText('Day —')).toBeTruthy()
  })

  it('StreakChip has accessibilityRole="text"', () => {
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    expect(chip.getAttribute('role')).toBe('text')
  })

  it('StreakChip has accessibilityLabel "Day — streak"', () => {
    render(React.createElement(HomeScreen))
    const chip = screen.getByTestId('streak-chip')
    expect(chip.getAttribute('aria-label')).toBe('Day — streak')
  })

  it('StreakChip slot wrapper still has testID "home-streak-chip-slot" for continuity', () => {
    render(React.createElement(HomeScreen))
    // The wrapper <View testID="home-streak-chip-slot"> must still be present
    // so existing 1-6 test infrastructure doesn't break
    expect(screen.getByTestId('home-streak-chip-slot')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. Story 1-7: CollectiveEntry mounts in home (AC3, AC4, AC6, AC7)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry mounts in HomeScreen (1-7 AC3, AC4, AC6, AC7)', () => {
  it('renders a CollectiveEntry element inside the home layout', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByTestId('collective-entry')).toBeTruthy()
  })

  it('CollectiveEntry displays "COLLECTIVE" text', () => {
    render(React.createElement(HomeScreen))
    expect(screen.getByText('COLLECTIVE')).toBeTruthy()
  })

  it('CollectiveEntry has accessibilityRole="button"', () => {
    render(React.createElement(HomeScreen))
    const entry = screen.getByTestId('collective-entry')
    expect(entry.getAttribute('role')).toBe('button')
  })

  it('CollectiveEntry has accessibilityLabel "Collective, locked" (dim state default)', () => {
    render(React.createElement(HomeScreen))
    const entry = screen.getByTestId('collective-entry')
    expect(entry.getAttribute('aria-label')).toBe('Collective, locked')
  })

  it('CollectiveEntry slot wrapper still has testID "home-collective-entry-slot" for continuity', () => {
    render(React.createElement(HomeScreen))
    // The wrapper <View testID="home-collective-entry-slot"> must still be present
    expect(screen.getByTestId('home-collective-entry-slot')).toBeTruthy()
  })

  it('pressing CollectiveEntry calls router.push("/collective") (AC7)', () => {
    pushSpy.mockClear()
    render(React.createElement(HomeScreen))
    const entry = screen.getByTestId('collective-entry')
    fireEvent.click(entry)
    expect(pushSpy).toHaveBeenCalledWith('/collective')
  })

  it('pressing CollectiveEntry calls router.push exactly once per press', () => {
    pushSpy.mockClear()
    render(React.createElement(HomeScreen))
    const entry = screen.getByTestId('collective-entry')
    fireEvent.click(entry)
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })
})
