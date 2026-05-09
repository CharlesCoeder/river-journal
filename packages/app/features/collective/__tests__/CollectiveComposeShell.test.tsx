// @vitest-environment happy-dom
/**
 * CollectiveComposeShell — behavioral integration test (iteration 2).
 *
 * Mounts the real shell with mocks producing the "eligible" state and asserts
 * that the gate passes through to PostComposer and the editor mounts.
 *
 * Replaces iteration-1 tautological source-string regex assertions on
 * PostComposer.tsx that didn't exercise actual behavior.
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('app/state/collective/feed', () => ({
  useFeed: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('../useCollectiveEligibility', () => ({
  useCollectiveEligibility: () => ({ status: 'eligible' as const }),
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

// Stub out PostComposer's heavyweight dependencies so the shell can mount
// in a JSDOM env without dragging in Lexical, Tamagui, or the real disclosure.
vi.mock('../CollectiveLexicalEditor', () => {
  const ReactMod = require('react')
  return {
    __esModule: true,
    default: ({ minHeight }: { minHeight?: number }) =>
      ReactMod.createElement('div', {
        'data-testid': 'collective-lexical-editor',
        'data-min-height': minHeight,
      }),
  }
})

vi.mock('app/features/disclosure/ThreePostureDisclosure', () => ({
  hasAcknowledgedBoundaryA: () => true,
  ThreePostureDisclosure: (_props: any) => null,
}))

vi.mock('app/features/disclosure/AmbientPrivacyLabel', () => {
  const ReactMod = require('react')
  return {
    AmbientPrivacyLabel: () =>
      ReactMod.createElement('span', { 'data-testid': 'ambient-label' }),
  }
})

vi.mock('app/state/collective/mutations', () => ({
  useCreatePost: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  createPostWithId: (vars: any) => ({ ...vars, id: 'uuid-test' }),
}))

vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => 'user-test-1',
}))

vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      preferences: {
        collective_show_tenure_tier: { get: () => false },
      },
    },
  },
}))

vi.mock('@my/ui', async () => {
  const ReactMod = await import('react')
  return {
    Text: ({ children, ...p }: any) => ReactMod.createElement('span', p, children),
    XStack: ({ children, ...p }: any) =>
      ReactMod.createElement('div', { ...p, 'data-stack': 'x' }, children),
    YStack: ({ children, ...p }: any) =>
      ReactMod.createElement('div', { ...p, 'data-stack': 'y' }, children),
    ExpandingLineButton: ({ children, onPress, disabled }: any) =>
      ReactMod.createElement(
        'button',
        { onClick: onPress, disabled: !!disabled },
        children
      ),
    AuthorByline: ({ displayName }: any) =>
      ReactMod.createElement('span', { 'data-testid': 'byline' }, displayName),
  }
})

import CollectiveComposeShell from '../CollectiveComposeShell'

afterEach(() => {
  cleanup()
})

describe('CollectiveComposeShell — eligible-state integration (iteration 2)', () => {
  it('renders PostComposer (editor mounted) when gate reports eligible', () => {
    render(React.createElement(CollectiveComposeShell))
    const editor = document.querySelector(
      '[data-testid="collective-lexical-editor"]'
    )
    expect(editor).not.toBeNull()
  })
})
