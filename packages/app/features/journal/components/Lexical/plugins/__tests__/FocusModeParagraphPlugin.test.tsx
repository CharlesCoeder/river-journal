// @vitest-environment happy-dom
// FocusModeParagraphPlugin — smoke tests
// RED-PHASE TDD: all tests fail before implementation.
//   - FocusModeParagraphPlugin does not yet exist at
//     packages/app/features/journal/components/Lexical/plugins/FocusModeParagraphPlugin.tsx
//   - computeFocusClasses helper does not yet exist
//
// Test strategy (per story Dev Notes — Testing Standards):
//   Part A: Pure helper unit tests for `computeFocusClasses` (extracted logic).
//   Part B: Component smoke tests asserting plugin mount behavior and Lexical wiring.
//
// IMPORTANT: The plugin module does not yet exist. vi.mock stubs the missing
// module so imports succeed. All tests assert on the NOT-YET-EXPORTED symbols
// and will fail until the implementation adds them.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

// Implementation exists — real module is imported directly below.

// ─────────────────────────────────────────────────────────────────────────────
// Stub heavy Lexical internals that require a full browser environment.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('@lexical/react/LexicalComposer', () => {
  const React = require('react')
  return {
    LexicalComposer: ({ children }: any) =>
      React.createElement('div', { 'data-testid': 'lexical-composer' }, children),
  }
})

vi.mock('lexical', () => ({
  $getRoot: vi.fn(() => ({ getChildren: vi.fn(() => []), getKey: vi.fn(() => 'root') })),
  $getSelection: vi.fn(() => null),
  $isRangeSelection: vi.fn(() => false),
  $isParagraphNode: vi.fn(() => false),
  $isElementNode: vi.fn(() => true),
  ParagraphNode: class ParagraphNode {},
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: vi.fn(() => [
    {
      registerUpdateListener: vi.fn(() => () => {}),
      getElementByKey: vi.fn(() => null),
    },
  ]),
}))

// ─── Import under test (resolves via the vi.mock stub above) ─────────────────
import {
  computeFocusClasses,
  FocusModeParagraphPlugin,
  CLASS_ACTIVE,
  CLASS_DIM,
} from '../FocusModeParagraphPlugin'

afterEach(() => {
  cleanup()
})

// =============================================================================
// Part A: computeFocusClasses — pure helper unit tests (AC 24)
// =============================================================================

describe('computeFocusClasses — pure helper (AC 24)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // CH-0: computeFocusClasses is exported as a function
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-0: computeFocusClasses is exported as a function', () => {
    expect(typeof computeFocusClasses).toBe('function')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // CH-1: focusMode=true — first paragraph active
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-1a: focusMode=true — activeKey is in the active list', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], true)
    expect(result?.active).toContain('key-1')
  })

  it('CH-1b: focusMode=true — non-active key is in the dim list', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], true)
    expect(result?.dim).toContain('key-2')
  })

  it('CH-1c: active list does NOT contain the dim key', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], true)
    expect(result?.active).not.toContain('key-2')
  })

  it('CH-1d: dim list does NOT contain the active key', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], true)
    expect(result?.dim).not.toContain('key-1')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // CH-2: focusMode=true — second paragraph active (classes swap)
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-2a: focusMode=true — active key is second, second is in active list', () => {
    const result = computeFocusClasses('key-2', ['key-1', 'key-2'], true)
    expect(result?.active).toContain('key-2')
  })

  it('CH-2b: focusMode=true — first key is in the dim list after swap', () => {
    const result = computeFocusClasses('key-2', ['key-1', 'key-2'], true)
    expect(result?.dim).toContain('key-1')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // CH-3: focusMode=false → both lists are empty (classes stripped)
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-3a: focusMode=false — active list is empty', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], false)
    expect(result?.active ?? []).toHaveLength(0)
  })

  it('CH-3b: focusMode=false — dim list is empty', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], false)
    expect(result?.dim ?? []).toHaveLength(0)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // CH-4: activeKey=null — no active paragraph
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-4a: activeKey=null — active list is empty', () => {
    const result = computeFocusClasses(null, ['key-1', 'key-2'], true)
    expect(result?.active ?? []).toHaveLength(0)
  })

  it('CH-4b: activeKey=null — dim list is empty (no dim without active)', () => {
    const result = computeFocusClasses(null, ['key-1', 'key-2'], true)
    expect(result?.dim ?? []).toHaveLength(0)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // CH-5: Three paragraphs — middle is active, others are dim
  // ───────────────────────────────────────────────────────────────────────────
  it('CH-5a: three paragraphs — middle key is active', () => {
    const result = computeFocusClasses('key-2', ['key-1', 'key-2', 'key-3'], true)
    expect(result?.active).toContain('key-2')
  })

  it('CH-5b: three paragraphs — first and third keys are dim', () => {
    const result = computeFocusClasses('key-2', ['key-1', 'key-2', 'key-3'], true)
    expect(result?.dim).toContain('key-1')
    expect(result?.dim).toContain('key-3')
  })

  it('CH-5c: three paragraphs — dim list has length allKeys.length - 1', () => {
    const result = computeFocusClasses('key-2', ['key-1', 'key-2', 'key-3'], true)
    expect(result?.dim ?? []).toHaveLength(2)
  })
})

// =============================================================================
// Part B: FocusModeParagraphPlugin component smoke tests (AC 24)
// =============================================================================

describe('FocusModeParagraphPlugin component — mount behavior (AC 24)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // PS-0: Module exports FocusModeParagraphPlugin as a function/component
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-0: FocusModeParagraphPlugin is exported as a function', () => {
    expect(typeof FocusModeParagraphPlugin).toBe('function')
  })

  it('PS-0b: renders without throwing when focusMode=true, readOnly=false', () => {
    expect(() => {
      render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: false }))
    }).not.toThrow()
  })

  it('PS-0c: renders without throwing when focusMode=false', () => {
    expect(() => {
      render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: false, readOnly: false }))
    }).not.toThrow()
  })

  it('PS-0d: renders without throwing when readOnly=true', () => {
    expect(() => {
      render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: true }))
    }).not.toThrow()
  })

  it('PS-0e: returns null (no DOM nodes rendered)', () => {
    const { container } = render(
      React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: false })
    )
    expect(container.firstChild).toBeNull()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PS-1: CSS class name constants — contract documentation
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-1: CLASS_ACTIVE constant equals "rj-focus-active"', () => {
    expect(CLASS_ACTIVE).toBe('rj-focus-active')
  })

  it('PS-1b: CLASS_DIM constant equals "rj-focus-dim"', () => {
    expect(CLASS_DIM).toBe('rj-focus-dim')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PS-2: readOnly=true → plugin does NOT register update listener (no-op)
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-2: readOnly=true — does NOT call registerUpdateListener', async () => {
    const { useLexicalComposerContext } = await import('@lexical/react/LexicalComposerContext')
    const mockRegister = vi.fn(() => () => {})
    ;(useLexicalComposerContext as any).mockReturnValue([
      { registerUpdateListener: mockRegister, getElementByKey: vi.fn(() => null) },
    ])

    render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: true }))

    expect(mockRegister).not.toHaveBeenCalled()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PS-3: focusMode=true, readOnly=false → registerUpdateListener IS called
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-3: focusMode=true, readOnly=false — calls registerUpdateListener', async () => {
    const { useLexicalComposerContext } = await import('@lexical/react/LexicalComposerContext')
    const mockRegister = vi.fn(() => () => {})
    ;(useLexicalComposerContext as any).mockReturnValue([
      { registerUpdateListener: mockRegister, getElementByKey: vi.fn(() => null) },
    ])

    render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: false }))

    expect(mockRegister).toHaveBeenCalled()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PS-4: getElementByKey is called for each paragraph key when listener fires
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-4: getElementByKey called for each paragraph node key when listener fires', async () => {
    const { useLexicalComposerContext } = await import('@lexical/react/LexicalComposerContext')
    const { $getRoot, $getSelection, $isRangeSelection, $isParagraphNode } = await import('lexical')

    const getElementByKeySpy = vi.fn(() => null)
    let capturedListener: ((payload: any) => void) | null = null

    ;(useLexicalComposerContext as any).mockReturnValue([
      {
        registerUpdateListener: vi.fn((cb: any) => {
          capturedListener = cb
          return () => {}
        }),
        getElementByKey: getElementByKeySpy,
      },
    ])

    const rootMock = { getChildren: () => [], getKey: () => 'root' }
    const mockP1 = { getKey: () => 'key-p1', getType: () => 'paragraph', getParent: () => rootMock }
    const mockP2 = { getKey: () => 'key-p2', getType: () => 'paragraph', getParent: () => rootMock }
    ;(rootMock as any).getChildren = () => [mockP1, mockP2]
    ;($getRoot as any).mockReturnValue(rootMock)
    ;($isParagraphNode as any).mockReturnValue(true)
    ;($isRangeSelection as any).mockReturnValue(true)
    ;($getSelection as any).mockReturnValue({
      anchor: { getNode: () => mockP1 },
    })

    render(React.createElement(FocusModeParagraphPlugin as any, { focusMode: true, readOnly: false }))

    if (capturedListener) {
      act(() => {
        ;(capturedListener as any)({
          editorState: { read: (cb: () => void) => cb() },
        })
      })
      expect(getElementByKeySpy).toHaveBeenCalledWith('key-p1')
      expect(getElementByKeySpy).toHaveBeenCalledWith('key-p2')
    } else {
      // Listener was never captured → registerUpdateListener was not called
      expect(capturedListener).not.toBeNull()
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PS-5: focusMode=false strips both classes (via computeFocusClasses delegation)
  // ───────────────────────────────────────────────────────────────────────────
  it('PS-5: focusMode=false — computeFocusClasses returns empty active+dim (OFF strips classes)', () => {
    const result = computeFocusClasses('key-1', ['key-1', 'key-2'], false)
    expect(result?.active ?? []).toHaveLength(0)
    expect(result?.dim ?? []).toHaveLength(0)
  })
})
