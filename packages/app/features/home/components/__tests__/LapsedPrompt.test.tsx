// @vitest-environment happy-dom
// LapsedPrompt component — render, copy, a11y, dismiss-on-tap
// Mocks useLapsedPrompt to isolate the component from state layer.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── @my/ui mock ─────────────────────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')
  const Text = ({ children, onPress, testID, accessibilityRole, accessibilityLabel, ...props }: any) =>
    ReactModule.createElement(
      'span',
      {
        ...props,
        ...(testID ? { 'data-testid': testID } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children
    )
  Text.displayName = 'Text'
  return { Text }
})

// ─── useLapsedPrompt mock — controllable per-test ─────────────────────────────
const lapsedMock = { shouldShow: false, dismiss: vi.fn() }

vi.mock('../../useLapsedPrompt', () => ({
  useLapsedPrompt: () => lapsedMock,
}))

import { LapsedPrompt } from '../LapsedPrompt'

afterEach(() => {
  cleanup()
  lapsedMock.dismiss = vi.fn()
  lapsedMock.shouldShow = false
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hidden state — renders null (AC4)
// ─────────────────────────────────────────────────────────────────────────────
describe('LapsedPrompt — hidden when shouldShow is false (AC4)', () => {
  it('renders nothing (no DOM node) when shouldShow is false', () => {
    lapsedMock.shouldShow = false
    render(React.createElement(LapsedPrompt))
    expect(screen.queryByTestId('lapsed-prompt')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Visible state — copy and a11y (AC4, AC7, AC8)
// ─────────────────────────────────────────────────────────────────────────────
describe('LapsedPrompt — visible when shouldShow is true (AC4, AC7, AC8)', () => {
  beforeEach(() => {
    lapsedMock.shouldShow = true
  })

  it('renders the literal text "Want to start again?"', () => {
    render(React.createElement(LapsedPrompt))
    expect(screen.getByText('Want to start again?')).toBeTruthy()
  })

  it('has aria-label "Want to start again? Tap to dismiss." (AC8)', () => {
    render(React.createElement(LapsedPrompt))
    const prompt = screen.getByTestId('lapsed-prompt')
    expect(prompt.getAttribute('aria-label')).toBe('Want to start again? Tap to dismiss.')
  })

  it('has role="button" (accessibilityRole="button") (AC8)', () => {
    render(React.createElement(LapsedPrompt))
    const prompt = screen.getByTestId('lapsed-prompt')
    expect(prompt.getAttribute('role')).toBe('button')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dismiss on tap (AC5)
// ─────────────────────────────────────────────────────────────────────────────
describe('LapsedPrompt — dismiss on tap (AC5)', () => {
  it('calls dismiss() when the prompt is tapped/clicked', () => {
    lapsedMock.shouldShow = true
    render(React.createElement(LapsedPrompt))
    const prompt = screen.getByTestId('lapsed-prompt')
    fireEvent.click(prompt)
    expect(lapsedMock.dismiss).toHaveBeenCalledTimes(1)
  })
})
