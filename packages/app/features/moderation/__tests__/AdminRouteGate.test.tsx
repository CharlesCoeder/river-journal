// @vitest-environment happy-dom
/**
 * AdminRouteGate tests.
 *
 *   - boundary invariant: the gate file does NOT import Legend-State directly
 *     (the admin-status read happens inside useIsAdmin, the permitted
 *     features/ carve-out hook -- mirrors CollectiveAccessGate's own
 *     boundary-invariant test)
 *   - loading (hook value undefined): renders a neutral loading state, never
 *     the child, never "Not authorized" (no premature flash either way)
 *   - unauthenticated (hook value null) and non-admin (hook value false):
 *     both render "Not authorized", child never mounts
 *   - admin (hook value === true): renders the child
 *   - fail-closed precedence: any truthy-but-not-strict-true hook value
 *     (a "true" string, the number 1, or an unexpected object) renders
 *     "Not authorized" and does NOT mount the child -- locks in the
 *     `=== true` branch so a future refactor can't silently open the gate
 *   - "Not authorized" exposes a "Return home" affordance that routes to '/'
 *   - sign-out while mounted: a mounted, admin-granted gate re-closes to
 *     "Not authorized" the moment the underlying hook value drops to null
 *     (simulates useIsAdmin's own onAuthStateChange-driven transition)
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const FEATURES_DIR = path.resolve(__dirname, '..')
const GATE_PATH = path.join(FEATURES_DIR, 'AdminRouteGate.tsx')

const CHILD_TESTID = 'admin-route-gate-child-sentinel'

// biome-ignore lint: test-only mutable mock state, reassigned per test
let mockIsAdminValue: unknown = undefined

const mockRouterPush = vi.fn()

vi.mock('app/state/collective/isAdmin', () => ({
  useIsAdmin: () => mockIsAdminValue,
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapCommon = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props.id !== undefined) out.id = props.id
    if (props['aria-label'] !== undefined) out['aria-label'] = props['aria-label']
    if (props.accessibilityLabel !== undefined) out['aria-label'] = props.accessibilityLabel
    if (props.role !== undefined) out.role = props.role
    if (props.accessibilityRole !== undefined) out.role = props.accessibilityRole
    if (props.testID !== undefined) out['data-testid'] = props.testID
    if (props['data-testid'] !== undefined) out['data-testid'] = props['data-testid']
    if (props.onPress) out.onClick = props.onPress
    return out
  }

  const Text = ({ children, ...props }: any) =>
    ReactModule.createElement('span', mapCommon(props), children)
  const View = ({ children, ...props }: any) =>
    ReactModule.createElement('div', mapCommon(props), children)
  const YStack = ({ children, ...props }: any) =>
    ReactModule.createElement('div', { 'data-stack': 'y', ...mapCommon(props) }, children)

  const ExpandingLineButton = ({ children, onPress, accessibilityLabel, ...props }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        onClick: onPress,
        'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
        ...mapCommon(props),
      },
      children
    )

  return {
    Text,
    View,
    YStack,
    ExpandingLineButton,
    useReducedMotion: () => true,
  }
})

// eslint-disable-next-line import/first
import { AdminRouteGate } from '../AdminRouteGate'

function ChildSentinel() {
  return React.createElement('div', { 'data-testid': CHILD_TESTID }, 'ADMIN CONTENT')
}

function renderGate() {
  return render(React.createElement(AdminRouteGate, null, React.createElement(ChildSentinel)))
}

function queryChild(): HTMLElement | null {
  return screen.queryByTestId(CHILD_TESTID)
}

beforeEach(() => {
  mockIsAdminValue = undefined
  mockRouterPush.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('AdminRouteGate — boundary invariant', () => {
  it('does NOT import Legend-State directly (the read happens in useIsAdmin)', () => {
    expect(existsSync(GATE_PATH)).toBe(true)
    const src = readFileSync(GATE_PATH, 'utf8')
    expect(src).not.toMatch(/@legendapp\/state/)
    expect(src).not.toMatch(/app\/state\/store/)
  })
})

describe('AdminRouteGate — loading (hook value undefined)', () => {
  it('renders a neutral loading state, not the child', () => {
    mockIsAdminValue = undefined
    renderGate()
    expect(screen.getByTestId('admin-route-gate-loading')).not.toBeNull()
    expect(queryChild()).toBeNull()
  })

  it('does NOT render "Not authorized" while loading (no premature deny flash)', () => {
    mockIsAdminValue = undefined
    renderGate()
    expect(screen.queryByTestId('admin-route-gate-not-authorized')).toBeNull()
  })
})

describe('AdminRouteGate — unauthenticated (hook value null)', () => {
  it('renders "Not authorized", not the child', () => {
    mockIsAdminValue = null
    renderGate()
    expect(screen.getByTestId('admin-route-gate-not-authorized')).not.toBeNull()
    expect(queryChild()).toBeNull()
  })
})

describe('AdminRouteGate — authenticated non-admin (hook value false)', () => {
  it('renders "Not authorized", not the child', () => {
    mockIsAdminValue = false
    renderGate()
    expect(screen.getByTestId('admin-route-gate-not-authorized')).not.toBeNull()
    expect(queryChild()).toBeNull()
  })
})

describe('AdminRouteGate — admin (hook value === true)', () => {
  it('renders the child', () => {
    mockIsAdminValue = true
    renderGate()
    expect(queryChild()).not.toBeNull()
  })

  it('does NOT render "Not authorized" alongside the child', () => {
    mockIsAdminValue = true
    renderGate()
    expect(screen.queryByTestId('admin-route-gate-not-authorized')).toBeNull()
  })
})

describe('AdminRouteGate — fail-closed on truthy-but-not-strict-true values', () => {
  const cases: Array<[string, unknown]> = [
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['an unexpected object', { is_admin: true }],
  ]

  for (const [label, value] of cases) {
    it(`${label} renders "Not authorized" and does not mount the child`, () => {
      mockIsAdminValue = value
      renderGate()
      expect(screen.getByTestId('admin-route-gate-not-authorized')).not.toBeNull()
      expect(queryChild()).toBeNull()
    })
  }
})

describe('AdminRouteGate — "Not authorized" affordance', () => {
  it('a "Return home" control routes to /', () => {
    mockIsAdminValue = null
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: /return home/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })
})

describe('AdminRouteGate — sign-out while mounted re-closes the gate', () => {
  it('an admin-granted gate flips to "Not authorized" once the hook value drops to null', () => {
    mockIsAdminValue = true
    const { rerender } = renderGate()
    expect(queryChild()).not.toBeNull()

    mockIsAdminValue = null
    rerender(React.createElement(AdminRouteGate, null, React.createElement(ChildSentinel)))

    expect(queryChild()).toBeNull()
    expect(screen.getByTestId('admin-route-gate-not-authorized')).not.toBeNull()
  })

  it('an admin-granted gate flips to "Not authorized" once the hook value drops to false', () => {
    mockIsAdminValue = true
    const { rerender } = renderGate()
    expect(queryChild()).not.toBeNull()

    mockIsAdminValue = false
    rerender(React.createElement(AdminRouteGate, null, React.createElement(ChildSentinel)))

    expect(queryChild()).toBeNull()
    expect(screen.getByTestId('admin-route-gate-not-authorized')).not.toBeNull()
  })
})
