// @vitest-environment happy-dom
// UnlockNotification component — render tests
// RED-PHASE TDD: all tests fail before the component file exists.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── Mock @my/ui — forward children + role/onPress to HTML elements ────────
// UnlockNotification imports { Text, YStack, ExpandingLineButton } from '@my/ui'.
// We intercept the entire package and expose testable HTML primitives.
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const mapped: Record<string, unknown> = {}
    if (props.testID) mapped['data-testid'] = props.testID
    if (props.onPress) mapped['onClick'] = props.onPress
    if (props.role) mapped['role'] = props.role
    if (props['aria-label']) mapped['aria-label'] = props['aria-label']
    if (props.accessibilityLabel) mapped['aria-label'] = props.accessibilityLabel
    if (props.accessibilityRole) mapped['role'] = props.accessibilityRole
    return mapped
  }

  const makeTag =
    (tag: keyof HTMLElementTagNameMap) =>
    ({ children, ...rest }: any) =>
      ReactModule.createElement(tag, mapProps(rest), children)

  // ExpandingLineButton renders as a <button> so role="button" queries work naturally.
  const ExpandingLineButton = ({ children, onPress, ...rest }: any) =>
    ReactModule.createElement(
      'button',
      {
        onClick: onPress,
        type: 'button',
        ...mapProps(rest),
      },
      children
    )

  return {
    Text: makeTag('span'),
    YStack: makeTag('div'),
    XStack: makeTag('div'),
    View: makeTag('div'),
    ExpandingLineButton,
    AnimatePresence: ({ children }: any) => children,
  }
})

import { UnlockNotification } from '../UnlockNotification'

afterEach(cleanup)

// ─────────────────────────────────────────────────────────────────────────────
// U1 — Renders the copy
// ─────────────────────────────────────────────────────────────────────────────
describe('UnlockNotification — U1: renders unlock copy (AC 17)', () => {
  it('U1: renders "You\'ve earned an unlock — choose a theme."', () => {
    render(React.createElement(UnlockNotification, { onChooseTheme: () => {} }))
    expect(screen.getByText("You've earned an unlock — choose a theme.")).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// U2 — Renders the "Choose theme" button
// ─────────────────────────────────────────────────────────────────────────────
describe('UnlockNotification — U2: renders Choose theme button (AC 17)', () => {
  it('U2: renders a button with accessible name "Choose theme"', () => {
    render(React.createElement(UnlockNotification, { onChooseTheme: () => {} }))
    // ExpandingLineButton renders as <button>; text content is the accessible name.
    const btn = screen.getByRole('button', { name: 'Choose theme' })
    expect(btn).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// U3 — onChooseTheme is called on press
// ─────────────────────────────────────────────────────────────────────────────
describe('UnlockNotification — U3: onChooseTheme callback fires on press (AC 17)', () => {
  it('U3: calls onChooseTheme exactly once when the Choose theme button is pressed', () => {
    const onChooseTheme = vi.fn()
    render(React.createElement(UnlockNotification, { onChooseTheme }))
    const btn = screen.getByRole('button', { name: 'Choose theme' })
    fireEvent.click(btn)
    expect(onChooseTheme).toHaveBeenCalledTimes(1)
  })
})
