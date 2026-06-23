// @vitest-environment happy-dom
/**
 * CollectiveEligibilityGate tests.
 *   - per-state render assertions (loading, unauthenticated, suspended,
 *     sync-disabled, not-qualified, eligible)
 *   - editor-not-mounted invariant (children only rendered in eligible)
 *   - action buttons fire correct router pushes
 *   - compact-variant Cancel button visible + functional in EVERY ineligible
 *     branch (loading, unauthenticated, suspended, sync-disabled, not-qualified)
 *   - structural invariant: gate file does NOT import CollectiveLexicalEditor
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const GATE_PATH = path.join(FEATURES_DIR, 'CollectiveEligibilityGate.tsx')

let mockStatus:
  | 'loading'
  | 'unauthenticated'
  | 'suspended'
  | 'sync-disabled'
  | 'not-qualified'
  | 'eligible' = 'eligible'

const mockRouterPush = vi.fn()

vi.mock('../useCollectiveEligibility', () => ({
  useCollectiveEligibility: () => ({ status: mockStatus }),
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: vi.fn() }),
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  return {
    Text: ({ children, ...props }: any) =>
      ReactModule.createElement('span', props, children),
    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...props }, children),
    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...props }, children),
    ExpandingLineButton: ({ children, onPress, ...props }: any) =>
      ReactModule.createElement(
        'button',
        { onClick: onPress, ...props },
        children
      ),
  }
})

import { CollectiveEligibilityGate } from '../CollectiveEligibilityGate'

const CHILD_TESTID = 'gate-child'
const Child = () =>
  React.createElement('div', { 'data-testid': CHILD_TESTID }, 'EDITOR')

afterEach(() => {
  cleanup()
  mockStatus = 'eligible'
  mockRouterPush.mockReset()
})

describe('CollectiveEligibilityGate — structural invariant', () => {
  it('CollectiveEligibilityGate.tsx does NOT import CollectiveLexicalEditor', () => {
    expect(existsSync(GATE_PATH)).toBe(true)
    const src = readFileSync(GATE_PATH, 'utf8')
    expect(src).not.toMatch(/CollectiveLexicalEditor/)
  })
})

describe('CollectiveEligibilityGate — eligible branch (children render)', () => {
  beforeEach(() => {
    mockStatus = 'eligible'
  })

  it('renders children when eligible', () => {
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    expect(screen.getByTestId(CHILD_TESTID)).not.toBeNull()
  })
})

describe('CollectiveEligibilityGate — non-eligible branches do NOT render children', () => {
  const statuses = [
    'loading',
    'unauthenticated',
    'suspended',
    'sync-disabled',
    'not-qualified',
  ] as const

  for (const s of statuses) {
    it(`status="${s}" does NOT render children`, () => {
      mockStatus = s
      render(
        React.createElement(
          CollectiveEligibilityGate,
          null,
          React.createElement(Child)
        )
      )
      expect(screen.queryByTestId(CHILD_TESTID)).toBeNull()
    })
  }
})

describe('CollectiveEligibilityGate — per-state copy + actions', () => {
  it('unauthenticated renders verbatim "Sign in to post."', () => {
    mockStatus = 'unauthenticated'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    expect(screen.getByText('Sign in to post.')).not.toBeNull()
  })

  it('suspended renders verbatim suspended copy', () => {
    mockStatus = 'suspended'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    expect(
      screen.getByText('Posting and reacting are paused for this account.')
    ).not.toBeNull()
  })

  it('sync-disabled renders golden privacy copy', () => {
    mockStatus = 'sync-disabled'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    expect(screen.getByText('Sync needs to be on to post.')).not.toBeNull()
    expect(
      screen.getByText(/encrypted entries\. Your journal content itself stays encrypted end-to-end/)
    ).not.toBeNull()
  })

  it('sync-disabled "Open Settings" button calls router.push("/settings")', () => {
    mockStatus = 'sync-disabled'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    fireEvent.click(screen.getByText('Open Settings'))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })

  it('not-qualified renders the 500-words copy', () => {
    mockStatus = 'not-qualified'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    expect(
      screen.getByText('Write 500 words today to post to the Collective.')
    ).not.toBeNull()
  })

  it('not-qualified "Open Journal" button calls router.push("/journal")', () => {
    mockStatus = 'not-qualified'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    fireEvent.click(screen.getByText('Open Journal'))
    expect(mockRouterPush).toHaveBeenCalledWith('/journal')
  })

  it('unauthenticated "Sign in" button calls router.push("/auth")', () => {
    mockStatus = 'unauthenticated'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        null,
        React.createElement(Child)
      )
    )
    fireEvent.click(screen.getByText('Sign in'))
    expect(mockRouterPush).toHaveBeenCalledWith('/auth')
  })
})

describe('CollectiveEligibilityGate — compact variant Cancel affordance', () => {
  const branches = [
    'loading',
    'unauthenticated',
    'suspended',
    'sync-disabled',
    'not-qualified',
  ] as const

  for (const s of branches) {
    it(`compact ${s}: Cancel button visible and calls onCancel`, () => {
      mockStatus = s
      const onCancel = vi.fn()
      render(
        React.createElement(
          CollectiveEligibilityGate,
          { variant: 'compact' as const, onCancel, children: React.createElement(Child) }
        )
      )
      const btn = screen.getByText('Cancel')
      expect(btn).not.toBeNull()
      fireEvent.click(btn)
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  }

  it('full variant: NO Cancel button rendered (back-button on the route handles dismissal)', () => {
    mockStatus = 'sync-disabled'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        { variant: 'full' as const, children: React.createElement(Child) }
      )
    )
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('compact without onCancel prop: NO Cancel button rendered', () => {
    mockStatus = 'sync-disabled'
    render(
      React.createElement(
        CollectiveEligibilityGate,
        { variant: 'compact' as const, children: React.createElement(Child) }
      )
    )
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})
