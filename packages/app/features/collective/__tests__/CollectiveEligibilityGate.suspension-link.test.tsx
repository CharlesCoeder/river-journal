// @vitest-environment happy-dom
/**
 * Covers the advisory enhancement to CollectiveEligibilityGate: the
 * suspended branch appends a tappable "View details in Settings" affordance
 * that navigates to /settings. This is advisory only — it changes no gating.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let mockStatus = 'suspended'
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
    Text: ({ children, onPress, ...props }: any) => {
      const domProps: Record<string, unknown> = {}
      if (props.testID) domProps['data-testid'] = props.testID
      if (onPress) domProps['onClick'] = onPress
      return ReactModule.createElement('span', domProps, children)
    },
    XStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x' }, children),
    YStack: ({ children }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y' }, children),
    ExpandingLineButton: ({ children, onPress }: any) =>
      ReactModule.createElement('button', { onClick: onPress }, children),
  }
})

import { CollectiveEligibilityGate } from '../CollectiveEligibilityGate'

afterEach(() => {
  cleanup()
  mockStatus = 'suspended'
  mockRouterPush.mockReset()
})

describe('CollectiveEligibilityGate — suspended "View details in Settings" link', () => {
  it('renders the advisory link in the suspended branch', () => {
    render(React.createElement(CollectiveEligibilityGate, null, React.createElement('div')))
    expect(screen.getByTestId('eligibility-gate-suspended-details-link')).toBeTruthy()
    expect(screen.getByText(/view details in settings/i)).toBeTruthy()
  })

  it('navigates to /settings when tapped', () => {
    render(React.createElement(CollectiveEligibilityGate, null, React.createElement('div')))
    fireEvent.click(screen.getByTestId('eligibility-gate-suspended-details-link'))
    expect(mockRouterPush).toHaveBeenCalledWith('/settings')
  })

  it('keeps the existing paused advisory copy', () => {
    render(React.createElement(CollectiveEligibilityGate, null, React.createElement('div')))
    expect(screen.getByText('Posting and reacting are paused for this account.')).toBeTruthy()
  })

  it('does NOT render the link when the user is not suspended', () => {
    mockStatus = 'eligible'
    render(React.createElement(CollectiveEligibilityGate, null, React.createElement('div')))
    expect(screen.queryByTestId('eligibility-gate-suspended-details-link')).toBeNull()
  })
})
