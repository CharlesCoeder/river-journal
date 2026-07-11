// @vitest-environment happy-dom
/**
 * Unit tests for the Settings active-suspension status section (advisory UI).
 *
 * Covers: renders expiry + reason + "you can still write and read." when the
 * caller has an active suspension; renders nothing when not suspended; omits the
 * reason line when the reason is null/blank; and treats an already-lapsed
 * ends_at as inactive (render-time expiry guard).
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let mockSuspension: {
  id: string
  kind: string
  starts_at: string
  ends_at: string
  reason: string | null
} | null = null

vi.mock('app/state/collective/suspension', () => ({
  useMyActiveSuspension: (_userId: string | null) => mockSuspension,
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  return {
    Text: ({ children, ...props }: any) => {
      const domProps: Record<string, unknown> = {}
      if (props.testID) domProps['data-testid'] = props.testID
      return ReactModule.createElement('span', domProps, children)
    },
    YStack: ({ children, ...props }: any) => {
      const domProps: Record<string, unknown> = {}
      if (props.testID) domProps['data-testid'] = props.testID
      return ReactModule.createElement('div', domProps, children)
    },
  }
})

import { SuspensionStatusSection } from '../SuspensionStatusSection'

const MONTHS =
  /January|February|March|April|May|June|July|August|September|October|November|December/

function futureIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  mockSuspension = null
})

afterEach(() => {
  cleanup()
})

describe('SuspensionStatusSection', () => {
  it('renders nothing when there is no active suspension', () => {
    mockSuspension = null
    const { container } = render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(container.firstChild).toBeNull()
  })

  it('renders the status section with a human expiry date when suspended', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: futureIso(),
      reason: 'harassment: repeated flags',
    }
    render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(screen.getByTestId('settings-suspension-status')).toBeTruthy()
    expect(screen.getByText(/paused until/i)).toBeTruthy()
    expect(screen.getByText(MONTHS)).toBeTruthy()
  })

  it('states the "you can still write and read" scope', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: futureIso(),
      reason: 'spam',
    }
    render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(screen.getByText(/you can still write and read/i)).toBeTruthy()
  })

  it('shows the reason verbatim when present', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: futureIso(),
      reason: 'harassment: repeated flags from other members',
    }
    render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(screen.getByText(/harassment: repeated flags from other members/)).toBeTruthy()
  })

  it('omits the reason line when reason is null', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: futureIso(),
      reason: null,
    }
    render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(screen.queryByTestId('settings-suspension-reason')).toBeNull()
    expect(screen.queryByText(/reason:/i)).toBeNull()
  })

  it('omits the reason line when reason is blank/whitespace', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: futureIso(),
      reason: '   ',
    }
    render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(screen.queryByText(/reason:/i)).toBeNull()
  })

  it('treats an already-lapsed ends_at as inactive (render-time expiry guard)', () => {
    mockSuspension = {
      id: 'susp-1',
      kind: 'post_react',
      starts_at: '2020-01-01T00:00:00.000Z',
      ends_at: '2020-02-01T00:00:00.000Z',
      reason: 'spam',
    }
    const { container } = render(React.createElement(SuspensionStatusSection, { userId: 'u1' }))
    expect(container.firstChild).toBeNull()
  })
})
