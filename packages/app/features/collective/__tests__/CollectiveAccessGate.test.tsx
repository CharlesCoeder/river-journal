// @vitest-environment happy-dom
/**
 * CollectiveAccessGate tests.
 *   - per-state render assertions (loading, unauthenticated → account gate,
 *     sync-disabled → sync gate, granted → feed)
 *   - the real feed mounts ONLY when access is granted
 *   - CTA buttons fire the correct router pushes (/auth, /settings)
 *   - both gated states render the unified locked screen (stepper + glimpse)
 *   - the dev-only `?gate=` override forces each state when the flag is on, and
 *     is a no-op when the flag is off
 *   - boundary invariant: gate file does NOT import Legend-State
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const GATE_PATH = path.join(FEATURES_DIR, 'CollectiveAccessGate.tsx')

let mockStatus: 'loading' | 'unauthenticated' | 'sync-disabled' | 'granted' = 'granted'
let mockDevEnabled = false

const mockRouterPush = vi.fn()

const FEED_TESTID = 'collective-feed-screen'

vi.mock('../useCollectiveAccess', () => ({
  useCollectiveAccess: () => ({ status: mockStatus }),
}))

vi.mock('../isCollectiveDevEnabled', () => ({
  isCollectiveDevEnabled: () => mockDevEnabled,
  COLLECTIVE_DEV_ROUTE: '/collective/dev',
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn() }),
}))

vi.mock('app/features/collective/CollectiveFeedScreen', () => ({
  default: () => React.createElement('div', { 'data-testid': FEED_TESTID }, 'FEED'),
}))

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
  const ReactModule = await import('react')
  const passA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props['aria-checked'] !== undefined) out['aria-checked'] = String(props['aria-checked'])
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    return out
  }
  return {
    Text: ({ children, ...props }: any) => ReactModule.createElement('span', passA11y(props), children),
    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...passA11y(props) }, children),
    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...passA11y(props) }, children),
    View: ({ children, onPress, ...props }: any) =>
      ReactModule.createElement('div', { onClick: onPress, ...passA11y(props) }, children),
    ScrollView: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-scroll': 'y', ...passA11y(props) }, children),
    ExpandingLineButton: ({ children, onPress, ...props }: any) =>
      ReactModule.createElement('button', { onClick: onPress, ...passA11y(props) }, children),
    useReducedMotion: () => true,
  }
})

import { CollectiveAccessGate } from '../CollectiveAccessGate'

afterEach(() => {
  cleanup()
  mockStatus = 'granted'
  mockDevEnabled = false
  mockRouterPush.mockReset()
  // Reset the URL so readGateParam() sees no override between tests.
  window.history.replaceState(null, '', '/collective/dev')
})

describe('CollectiveAccessGate — boundary invariant', () => {
  it('does NOT import Legend-State (reads happen in useCollectiveAccess)', () => {
    expect(existsSync(GATE_PATH)).toBe(true)
    const src = readFileSync(GATE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
    expect(src).not.toMatch(/app\/state\/store/)
  })
})

describe('CollectiveAccessGate — granted branch mounts the feed', () => {
  it('renders the real feed only when granted', () => {
    mockStatus = 'granted'
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId(FEED_TESTID)).not.toBeNull()
  })

  const gated = ['loading', 'unauthenticated', 'sync-disabled'] as const
  for (const s of gated) {
    it(`status="${s}" does NOT mount the feed`, () => {
      mockStatus = s
      render(React.createElement(CollectiveAccessGate))
      expect(screen.queryByTestId(FEED_TESTID)).toBeNull()
    })
  }
})

describe('CollectiveAccessGate — loading', () => {
  it('renders the skeleton placeholder', () => {
    mockStatus = 'loading'
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-loading')).not.toBeNull()
    expect(screen.getByTestId('skeleton-row-0')).not.toBeNull()
  })
})

describe('CollectiveAccessGate — unauthenticated → account gate', () => {
  beforeEach(() => {
    mockStatus = 'unauthenticated'
  })

  it('shows the account invitation + three stepper keys + glimpse', () => {
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-unauthenticated')).not.toBeNull()
    expect(screen.getByText('A room full of people who wrote today.')).not.toBeNull()
    expect(screen.getByText('An account')).not.toBeNull()
    expect(screen.getByText('Sync on')).not.toBeNull()
    expect(screen.getByText("Today's words")).not.toBeNull()
    expect(screen.getByText('A glimpse inside')).not.toBeNull()
  })

  it('CTA "Create an account" routes to /auth', () => {
    render(React.createElement(CollectiveAccessGate))
    fireEvent.click(screen.getByText('Create an account'))
    expect(mockRouterPush).toHaveBeenCalledWith('/auth')
  })

  it('secondary "Already have one? Log in" routes to /auth', () => {
    render(React.createElement(CollectiveAccessGate))
    fireEvent.click(screen.getByText('Already have one? Log in'))
    expect(mockRouterPush).toHaveBeenCalledWith('/auth')
  })
})

describe('CollectiveAccessGate — sync-disabled → sync gate', () => {
  beforeEach(() => {
    mockStatus = 'sync-disabled'
  })

  it('shows the enable-sync invitation + encryption note + glimpse', () => {
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-sync-disabled')).not.toBeNull()
    expect(screen.getByText('One last door — your letters, carried with you.')).not.toBeNull()
    expect(screen.getByText(/You choose how it's encrypted/i)).not.toBeNull()
    expect(screen.getByText('A glimpse inside')).not.toBeNull()
  })

  it('CTA "Enable sync" routes to /settings', () => {
    render(React.createElement(CollectiveAccessGate))
    fireEvent.click(screen.getByText('Enable sync'))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })
})

describe('CollectiveAccessGate — dev ?gate= override', () => {
  it('forces the account gate regardless of granted status', () => {
    mockDevEnabled = true
    mockStatus = 'granted'
    window.history.replaceState(null, '', '/collective/dev?gate=account')
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-dev-account')).not.toBeNull()
    expect(screen.getByText('A room full of people who wrote today.')).not.toBeNull()
    // The feed must NOT mount under the override.
    expect(screen.queryByTestId(FEED_TESTID)).toBeNull()
  })

  it('forces the sync gate', () => {
    mockDevEnabled = true
    mockStatus = 'granted'
    window.history.replaceState(null, '', '/collective/dev?gate=sync')
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-dev-sync')).not.toBeNull()
    expect(screen.getByText('One last door — your letters, carried with you.')).not.toBeNull()
  })

  it('forces the words gate and renders the DemoPanel', () => {
    mockDevEnabled = true
    mockStatus = 'unauthenticated'
    window.history.replaceState(null, '', '/collective/dev?gate=words')
    render(React.createElement(CollectiveAccessGate))
    expect(screen.getByTestId('collective-access-dev-words')).not.toBeNull()
    expect(screen.getByText('A quiet room, just through here.')).not.toBeNull()
    expect(screen.getByText('Demo · preview states')).not.toBeNull()
  })

  it('is a no-op when the dev flag is off (falls through to real status)', () => {
    mockDevEnabled = false
    mockStatus = 'granted'
    window.history.replaceState(null, '', '/collective/dev?gate=words')
    render(React.createElement(CollectiveAccessGate))
    expect(screen.queryByTestId('collective-access-dev-words')).toBeNull()
    expect(screen.getByTestId(FEED_TESTID)).not.toBeNull()
  })
})
