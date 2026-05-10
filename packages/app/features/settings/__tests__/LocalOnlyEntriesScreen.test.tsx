// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// --- Mocks ---

type Summary = {
  entryId: string
  entryDate: string
  totalWordCount: number
  flowIds: string[]
}

const mockUserId: ReturnType<typeof vi.fn> = vi.fn(() => 'user-123' as string | null)
const mockRestoreExcludedEntries = vi.fn()
const mockGetSummaries: ReturnType<typeof vi.fn> = vi.fn(() => [] as Summary[])
const mockInvalidateQueries = vi.fn()

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, disabled } = props as any
    return {
      ...(testID ? { 'data-testid': testID } : {}),
      ...(onPress ? { onClick: onPress } : {}),
      ...(disabled ? { disabled } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const ScrollView = ({ children, ...props }: any) =>
    ReactModule.createElement('div', mapProps(props), children)

  const ExpandingLineButton = ({ children, onPress, disabled, accessibilityLabel }: any) =>
    ReactModule.createElement(
      'button',
      {
        onClick: disabled ? undefined : onPress,
        disabled,
        'aria-label': accessibilityLabel,
      },
      children
    )

  const AlertDialog: any = ({ open, onOpenChange, children }: any) =>
    open ? ReactModule.createElement('div', { 'data-testid': 'alert-dialog' }, children) : null
  AlertDialog.Portal = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)
  AlertDialog.Overlay = () => null
  AlertDialog.Content = ({ children, testID }: any) =>
    ReactModule.createElement('div', { 'data-testid': testID }, children)
  AlertDialog.Title = passthrough('h2')
  AlertDialog.Description = passthrough('p')
  AlertDialog.Cancel = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)
  AlertDialog.Action = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    AlertDialog,
    Button: passthrough('button'),
    ExpandingLineButton,
    ScrollView,
    Text: passthrough('span'),
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

vi.mock('@legendapp/state/react', () => ({
  use$: (obs$: any) => {
    if (obs$ === '__mock_userId') return mockUserId()
    return undefined
  },
}))

vi.mock('app/state/store', () => ({
  flows$: '__mock_flows',
  entries$: '__mock_entries',
  store$: { session: { userId: '__mock_userId' } },
  restoreExcludedEntries: (...args: any[]) => mockRestoreExcludedEntries(...args),
  getLocallyExcludedEntries: () => mockGetSummaries(),
}))

vi.mock('app/state/queryClient', () => ({
  queryClient: { invalidateQueries: (...args: any[]) => mockInvalidateQueries(...args) },
}))

vi.mock('app/state/collective/eligibility', () => ({
  collectiveEligibilityKey: ['collective', 'eligibility'],
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

import { LocalOnlyEntriesScreen } from '../LocalOnlyEntriesScreen'

beforeEach(() => {
  mockUserId.mockReturnValue('user-123')
  mockRestoreExcludedEntries.mockReset()
  mockInvalidateQueries.mockReset()
  mockGetSummaries.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('LocalOnlyEntriesScreen', () => {
  it('shows empty state when no excluded entries exist', () => {
    mockGetSummaries.mockReturnValue([])
    render(React.createElement(LocalOnlyEntriesScreen))
    expect(screen.getByTestId('local-only-entries-empty')).toBeTruthy()
  })

  it('shows signed-out hint when userId is null', () => {
    mockUserId.mockReturnValue(null)
    mockGetSummaries.mockReturnValue([])
    render(React.createElement(LocalOnlyEntriesScreen))
    expect(screen.getByTestId('local-only-entries-signed-out')).toBeTruthy()
  })

  it('renders one row per excluded entry with word count', () => {
    mockGetSummaries.mockReturnValue([
      { entryId: 'e1', entryDate: '2026-03-05', totalWordCount: 250, flowIds: ['f1'] },
      { entryId: 'e2', entryDate: '2026-03-01', totalWordCount: 75, flowIds: ['f2'] },
    ])
    render(React.createElement(LocalOnlyEntriesScreen))
    expect(screen.getByTestId('local-only-row-e1')).toBeTruthy()
    expect(screen.getByTestId('local-only-row-e2')).toBeTruthy()
    expect(screen.getByText('250 words')).toBeTruthy()
    expect(screen.getByText('75 words')).toBeTruthy()
  })

  it('per-entry sync calls restore and invalidates eligibility, no confirmation', () => {
    mockGetSummaries.mockReturnValue([
      { entryId: 'e1', entryDate: '2026-03-05', totalWordCount: 250, flowIds: ['f1'] },
    ])
    render(React.createElement(LocalOnlyEntriesScreen))

    const row = screen.getByTestId('local-only-row-e1')
    const syncBtn = row.querySelector('button[aria-label^="Sync entry"]') as HTMLButtonElement
    fireEvent.click(syncBtn)

    expect(mockRestoreExcludedEntries).toHaveBeenCalledWith(['e1'], 'user-123')
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['collective', 'eligibility'],
    })
    expect(screen.queryByTestId('local-only-confirm-dialog')).toBeNull()
  })

  it('bulk sync opens confirmation; confirm triggers restore + invalidate', () => {
    mockGetSummaries.mockReturnValue([
      { entryId: 'e1', entryDate: '2026-03-05', totalWordCount: 250, flowIds: ['f1'] },
      { entryId: 'e2', entryDate: '2026-03-01', totalWordCount: 75, flowIds: ['f2'] },
    ])
    render(React.createElement(LocalOnlyEntriesScreen))

    const syncAllBtn = screen.getByLabelText('Sync all local-only entries') as HTMLButtonElement
    fireEvent.click(syncAllBtn)

    expect(screen.getByTestId('local-only-confirm-dialog')).toBeTruthy()
    expect(mockRestoreExcludedEntries).not.toHaveBeenCalled()

    const confirmBtn = screen.getByTestId('local-only-confirm-sync-all') as HTMLButtonElement
    fireEvent.click(confirmBtn)

    expect(mockRestoreExcludedEntries).toHaveBeenCalledWith(['e1', 'e2'], 'user-123')
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['collective', 'eligibility'],
    })
  })
})
