// @vitest-environment happy-dom
// CollectiveEntry component — uppercase text, onPress, dim/lit a11y, no router, no animation

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Mock tamagui — forward a11y + onPress props to a <span> ────────────────
// CollectiveEntry imports { Text } from 'tamagui'; we intercept here.
vi.mock('tamagui', () => {
  const ReactModule = require('react')

  const Text = ({
    children,
    accessibilityRole,
    accessibilityLabel,
    testID,
    onPress,
    animation,
    transition,
    enterStyle,
    exitStyle,
    ...rest
  }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...rest,
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
        // Surface animation/transition props as data attrs so tests can assert absence
        ...(animation !== undefined ? { 'data-animation': String(animation) } : {}),
        ...(transition !== undefined ? { 'data-transition': String(transition) } : {}),
        ...(enterStyle !== undefined ? { 'data-enter-style': 'present' } : {}),
        ...(exitStyle !== undefined ? { 'data-exit-style': 'present' } : {}),
      },
      children
    )

  return { Text }
})

import { CollectiveEntry } from '../CollectiveEntry'

afterEach(cleanup)

// ─────────────────────────────────────────────────────────────────────────────
// 1. Text rendering (AC3)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry renders uppercase COLLECTIVE text (AC3)', () => {
  it('renders text "COLLECTIVE"', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    expect(screen.getByText('COLLECTIVE')).toBeTruthy()
  })

  it('renders with no extra visible text beside COLLECTIVE', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.textContent).toBe('COLLECTIVE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. onPress prop — required, invoked on press (AC3, AC7)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry onPress invocation (AC3)', () => {
  it('calls onPress when the element is pressed/clicked', () => {
    const onPressSpy = vi.fn()
    render(React.createElement(CollectiveEntry, { onPress: onPressSpy }))
    const el = screen.getByText('COLLECTIVE')
    fireEvent.click(el)
    expect(onPressSpy).toHaveBeenCalledTimes(1)
  })

  it('calls onPress exactly once per press, not multiple times', () => {
    const onPressSpy = vi.fn()
    render(React.createElement(CollectiveEntry, { onPress: onPressSpy }))
    const el = screen.getByText('COLLECTIVE')
    fireEvent.click(el)
    fireEvent.click(el)
    expect(onPressSpy).toHaveBeenCalledTimes(2)
  })

  it('calls a different onPress spy when a new one is passed', () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const { rerender } = render(React.createElement(CollectiveEntry, { onPress: spy1 }))
    rerender(React.createElement(CollectiveEntry, { onPress: spy2 }))
    const el = screen.getByText('COLLECTIVE')
    fireEvent.click(el)
    expect(spy1).not.toHaveBeenCalled()
    expect(spy2).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Accessibility — dim vs lit state (AC6)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry accessibility — dim state (AC6)', () => {
  it('has accessibilityLabel "Collective, locked" in default (dim) state', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('aria-label')).toBe('Collective, locked')
  })

  it('has accessibilityLabel "Collective, locked" when state="dim" is explicit', () => {
    render(React.createElement(CollectiveEntry, { state: 'dim', onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('aria-label')).toBe('Collective, locked')
  })

  it('has accessibilityRole="button" (interactive element) (AC6)', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('role')).toBe('button')
  })

  it('is reachable by getByRole("button", { name: "Collective, locked" })', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    expect(screen.getByRole('button', { name: 'Collective, locked' })).toBeTruthy()
  })
})

describe('CollectiveEntry accessibility — lit state (AC6)', () => {
  it('has accessibilityLabel "Collective" (no comma, no "locked") when state="lit"', () => {
    render(React.createElement(CollectiveEntry, { state: 'lit', onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    // In lit state, "locked" qualifier is absent per AC6 spec
    expect(el.getAttribute('aria-label')).toBe('Collective')
  })

  it('still renders "COLLECTIVE" text when state="lit"', () => {
    render(React.createElement(CollectiveEntry, { state: 'lit', onPress: vi.fn() }))
    expect(screen.getByText('COLLECTIVE')).toBeTruthy()
  })

  it('still calls onPress when state="lit" and element is pressed', () => {
    const onPressSpy = vi.fn()
    render(React.createElement(CollectiveEntry, { state: 'lit', onPress: onPressSpy }))
    fireEvent.click(screen.getByText('COLLECTIVE'))
    expect(onPressSpy).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. No animation / transition props (AC5)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry has no animation props — static by design (AC5)', () => {
  it('rendered element has no data-animation attribute', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('data-animation')).toBeNull()
  })

  it('rendered element has no data-transition attribute', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('data-transition')).toBeNull()
  })

  it('rendered element has no data-enter-style attribute', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('data-enter-style')).toBeNull()
  })

  it('rendered element has no data-exit-style attribute', () => {
    render(React.createElement(CollectiveEntry, { onPress: vi.fn() }))
    const el = screen.getByText('COLLECTIVE')
    expect(el.getAttribute('data-exit-style')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. No router import — purely presentational component (AC3 package boundary)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollectiveEntry has no internal router dependency (AC3 package boundary)', () => {
  it('does not import solito — no useRouter call — onPress is the sole navigation contract', async () => {
    // Verify that the CollectiveEntry module source does not reference solito.
    // This is a static assertion: if the import existed, our test environment
    // would need to mock solito/navigation; since CollectiveEntry uses only onPress,
    // the module loads successfully without any solito mock.
    //
    // The fact that this test file has NO vi.mock('solito/navigation') and the
    // import above succeeds without error is the proof. We additionally read the
    // module source as a belt-and-suspenders check.
    const fs = await import('fs')
    const path = await import('path')
    const componentPath = path.resolve(
      __dirname,
      '../CollectiveEntry.tsx'
    )
    const source = fs.readFileSync(componentPath, 'utf-8')
    expect(source).not.toContain('solito')
    expect(source).not.toContain('useRouter')
  })

  it('does not import from @my/ui (avoids circular dep — imports from tamagui directly)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const componentPath = path.resolve(
      __dirname,
      '../CollectiveEntry.tsx'
    )
    const source = fs.readFileSync(componentPath, 'utf-8')
    expect(source).not.toContain("from '@my/ui'")
  })
})
