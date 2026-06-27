// @vitest-environment happy-dom
/**
 * CollectiveLockedScreen — the unified three-state gate (account / sync / words).
 *
 *   - per-gate headline, body, primary action, and secondary copy
 *   - the stepper shows all three keys in every state
 *   - the glimpse renders supplied rows (and nothing when empty)
 *   - actions fire the supplied callbacks (router wiring lives in the callers)
 *   - the dev-only DemoPanel renders only when `demo` controls are supplied
 *   - glimpseFromPosts maps real preview posts to glimpse rows
 *   - boundary invariant: the file does NOT import Legend-State
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const SCREEN_PATH = path.join(FEATURES_DIR, 'CollectiveLockedScreen.tsx')

vi.mock('@tamagui/lucide-icons', () => {
  const stub = () => () => null
  return {
    Lock: stub(),
    ArrowLeft: stub(),
    ArrowRight: stub(),
    Check: stub(),
    UserCircle: stub(),
    CloudUpload: stub(),
    PenLine: stub(),
  }
})

vi.mock('@my/ui', async () => {
  const R = await import('react')
  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props['aria-checked'] !== undefined) out['aria-checked'] = String(props['aria-checked'])
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    return out
  }
  return {
    Text: ({ children, ...props }: any) => R.createElement('span', mapA11y(props), children),
    XStack: ({ children, ...props }: any) =>
      R.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),
    YStack: ({ children, ...props }: any) =>
      R.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),
    View: ({ children, onPress, ...props }: any) =>
      R.createElement('div', { onClick: onPress, ...mapA11y(props) }, children),
    useReducedMotion: () => true,
  }
})

import {
  CollectiveLockedScreen,
  glimpseFromPosts,
  SAMPLE_GLIMPSE,
  type GlimpseItem,
} from '../CollectiveLockedScreen'

function baseProps() {
  return {
    onReturnHome: vi.fn(),
    onSignIn: vi.fn(),
    onEnableSync: vi.fn(),
    onStartWriting: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
})

describe('CollectiveLockedScreen — boundary invariant', () => {
  it('does NOT import Legend-State or the store', () => {
    expect(existsSync(SCREEN_PATH)).toBe(true)
    const src = readFileSync(SCREEN_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
    expect(src).not.toMatch(/from ['"]app\/state\/store['"]/)
  })
})

describe('CollectiveLockedScreen — shared chrome (all states)', () => {
  it('renders the eyebrow, the stepper keys, and the pulse in the account state', () => {
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'account',
        glimpse: [...SAMPLE_GLIMPSE],
        ...baseProps(),
      })
    )
    expect(screen.getByText('The Collective')).not.toBeNull()
    expect(screen.getByText('An account')).not.toBeNull()
    expect(screen.getByText('Sync on')).not.toBeNull()
    expect(screen.getByText("Today's words")).not.toBeNull()
    // Hard-coded community pulse (illustrative seed values).
    expect(screen.getByText('Writing together, today')).not.toBeNull()
    expect(screen.getByText('writers today')).not.toBeNull()
    expect(screen.getByText('words today')).not.toBeNull()
  })

  it('Back to Home fires onReturnHome', () => {
    const props = baseProps()
    render(React.createElement(CollectiveLockedScreen, { gate: 'account', ...props }))
    fireEvent.click(screen.getByText('Back to Home'))
    expect(props.onReturnHome).toHaveBeenCalledTimes(1)
  })
})

describe('CollectiveLockedScreen — account gate', () => {
  it('renders the account headline and both account actions', () => {
    const props = baseProps()
    render(React.createElement(CollectiveLockedScreen, { gate: 'account', ...props }))
    expect(screen.getByText('A room full of people who wrote today.')).not.toBeNull()
    fireEvent.click(screen.getByText('Create an account'))
    expect(props.onSignIn).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Already have one? Log in'))
    expect(props.onSignIn).toHaveBeenCalledTimes(2)
  })
})

describe('CollectiveLockedScreen — sync gate', () => {
  it('renders the sync headline, the encryption note, and the enable-sync action', () => {
    const props = baseProps()
    render(React.createElement(CollectiveLockedScreen, { gate: 'sync', ...props }))
    expect(screen.getByText('One last door — your letters, carried with you.')).not.toBeNull()
    expect(screen.getByText(/You choose how it's encrypted/i)).not.toBeNull()
    fireEvent.click(screen.getByText('Enable sync'))
    expect(props.onEnableSync).toHaveBeenCalledTimes(1)
  })
})

describe('CollectiveLockedScreen — words gate', () => {
  it('renders the words headline, progress, and "Begin writing" when at zero', () => {
    const props = baseProps()
    render(
      React.createElement(CollectiveLockedScreen, { gate: 'words', wordsToday: 0, ...props })
    )
    expect(screen.getByText('A quiet room, just through here.')).not.toBeNull()
    expect(screen.getByText(/Write 500 words of your own today/i)).not.toBeNull()
    expect(screen.getByText('500 to go')).not.toBeNull()
    fireEvent.click(screen.getByText('Begin writing'))
    expect(props.onStartWriting).toHaveBeenCalledTimes(1)
  })

  it('renders "Keep writing" and a remaining count when partway', () => {
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'words',
        wordsToday: 320,
        ...baseProps(),
      })
    )
    expect(screen.getByText('Keep writing')).not.toBeNull()
    expect(screen.getByText('180 to go')).not.toBeNull()
  })

  it('renders "Ready" once the goal is met', () => {
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'words',
        wordsToday: 500,
        ...baseProps(),
      })
    )
    expect(screen.getByText('Ready')).not.toBeNull()
  })
})

describe('CollectiveLockedScreen — glimpse', () => {
  it('renders supplied glimpse rows', () => {
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'account',
        glimpse: [...SAMPLE_GLIMPSE],
        ...baseProps(),
      })
    )
    expect(screen.getByText('A glimpse inside')).not.toBeNull()
    expect(screen.getByText(SAMPLE_GLIMPSE[0]!.title)).not.toBeNull()
  })

  it('omits the glimpse section when there are no rows', () => {
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'words',
        wordsToday: 0,
        glimpse: [],
        ...baseProps(),
      })
    )
    expect(screen.queryByText('A glimpse inside')).toBeNull()
  })
})

describe('CollectiveLockedScreen — dev DemoPanel', () => {
  it('does not render the DemoPanel in the normal flow', () => {
    render(React.createElement(CollectiveLockedScreen, { gate: 'account', ...baseProps() }))
    expect(screen.queryByText('Demo · preview states')).toBeNull()
  })

  it('renders the DemoPanel and fires toggle callbacks when demo controls are supplied', () => {
    const onToggleSignedIn = vi.fn()
    const onToggleSync = vi.fn()
    render(
      React.createElement(CollectiveLockedScreen, {
        gate: 'words',
        wordsToday: 320,
        demo: { signedIn: true, syncEnabled: true, onToggleSignedIn, onToggleSync },
        ...baseProps(),
      })
    )
    expect(screen.getByText('Demo · preview states')).not.toBeNull()
    fireEvent.click(screen.getByText('Signed in'))
    expect(onToggleSignedIn).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByText('Sync enabled'))
    expect(onToggleSync).toHaveBeenCalledWith(false)
  })
})

describe('glimpseFromPosts', () => {
  it('maps the first three posts to glimpse rows with title + byline', () => {
    const posts = [
      { id: 'p1', title: 'First', created_at: new Date().toISOString(), descendant_count: 1 },
      { id: 'p2', title: 'Second', created_at: new Date().toISOString(), descendant_count: 0 },
      { id: 'p3', title: 'Third', created_at: new Date().toISOString(), descendant_count: 4 },
      { id: 'p4', title: 'Fourth', created_at: new Date().toISOString(), descendant_count: 0 },
    ] as any[]
    const rows: GlimpseItem[] = glimpseFromPosts(posts)
    expect(rows).toHaveLength(3)
    expect(rows[0]!.title).toBe('First')
    expect(rows[0]!.sub).toMatch(/1 reply$/)
    expect(rows[1]!.sub).toMatch(/0 replies$/)
  })

  it('falls back to "Untitled" when a post has no title', () => {
    const rows = glimpseFromPosts([
      { id: 'p1', title: null, created_at: new Date().toISOString(), descendant_count: 0 },
    ] as any[])
    expect(rows[0]!.title).toBe('Untitled')
  })
})
