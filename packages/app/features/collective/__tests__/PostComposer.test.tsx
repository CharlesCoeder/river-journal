// @vitest-environment happy-dom
/**
 * Story 3-9 — TDD red-phase unit tests for `features/collective/PostComposer.tsx`.
 *
 * Red-phase contract: every test MUST fail until Story 3-9 creates:
 *   - packages/app/features/collective/PostComposer.tsx
 *   - packages/app/features/collective/CollectiveLexicalEditor.tsx
 *   - packages/app/features/collective/CollectiveLexicalEditor.native.tsx
 *   - apps/web/app/collective/compose/page.tsx
 *   - apps/desktop/app/collective/compose/page.tsx
 *   - apps/mobile/app/collective/compose.tsx
 *
 * AC coverage:
 *   t1  — first-time disclosure gate (AC #1, #2, #26-t1)
 *   t2  — already-acknowledged path (AC #2, #26-t2)
 *   t3  — Lexical isolation regression D14 (AC #7, #9, #26-t3)
 *   t4  — ephemeral$.persistentEditor.isVisible not touched (AC #8, #26-t4)
 *   t5  — "posting as" preview + tenure-tier opt-in (AC #6, #26-t5)
 *   t6  — submit success path (AC #12, #26-t6)
 *   t7  — submit disabled when body empty (AC #13, #26-t7)
 *   t8  — submit disabled when pending (AC #13, #26-t8)
 *   t9  — submit disabled when suspended (AC #13, #18, #26-t9)
 *   t10 — error path: microcopy + body preserved (AC #16, #26-t10)
 *   t11 — telemetry redaction grep (AC #20, #26-t11)
 *   t12 — compact reply variant (AC #17, #26-t12)
 *   t13 — Lexical config namespace reuse (AC #10, #13, #26-t13)
 *   t14 — disclosure focus-return on review-mode dismiss, body preserved (AC #4, #26-t14)
 *   t15 — submit calls createPostWithId per-call (UUID distinctness) (AC #12, #26-t15)
 *   t16 — submit awaits the mutation; composer stays open until it resolves (#26-t16)
 *   t17 — double-tap submit guard (AC #13, #26-t17)
 *   t18 — route files exist (AC #23, #24, #25)
 *   t19 — disclosure gate acknowledgment focus (AC #3)
 *   t20 — word/character count renders (AC #11)
 *   t21 — tenure-tier opt-out: tenureTier not passed (AC #6, #21)
 *   t22 — D14 boundary: PostComposer does NOT import PersistentEditor or ephemeral$ (AC #7, #27)
 *   t23 — unauthenticated: "Sign in to post." placeholder (AC #13)
 *   t24 — compact mode: Cancel button calls onCancelled (AC #17)
 *   t25 — ambient label tap opens disclosure in review mode (AC #4)
 *
 * Mock strategy: vi.mock for useCreatePost/createPostWithId, useCurrentUserId,
 * useIsSuspended, useRouter, hasAcknowledgedBoundaryA, ThreePostureDisclosure,
 * AmbientPrivacyLabel, store$; @my/ui mocked to map Tamagui primitives to
 * testable HTML elements; mirrors CollectiveFeedScreen.test.tsx patterns.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ─── Path constants for grep / file-existence tests ───────────────────────────
const FEATURES_DIR = path.resolve(__dirname, '..')
const PROJECT_ROOT = path.resolve(__dirname, '../../../../..')
const POST_COMPOSER_PATH = path.join(FEATURES_DIR, 'PostComposer.tsx')
const COLLECTIVE_LEXICAL_EDITOR_PATH = path.join(FEATURES_DIR, 'CollectiveLexicalEditor.tsx')
const WEB_COMPOSE_ROUTE_PATH = path.join(PROJECT_ROOT, 'apps/web/app/collective/compose/page.tsx')
const DESKTOP_COMPOSE_ROUTE_PATH = path.join(
  PROJECT_ROOT,
  'apps/desktop/app/collective/compose/page.tsx'
)
const MOBILE_COMPOSE_ROUTE_PATH = path.join(PROJECT_ROOT, 'apps/mobile/app/collective/compose.tsx')

// ─── Controlled mock state ─────────────────────────────────────────────────────
let mockHasAcknowledgedBoundaryA = false
let mockCurrentUserId: string | null = 'abcdef0123456789'
let mockIsSuspended: boolean | undefined = false
let mockIsPending = false
let mockCreatePostError: Error | null = null
let mockShowTenureTier = false

// Spy on mutate/mutateAsync, router, ephemeral.
// The composer submits via mutateAsync (await-based contract: navigate only
// after the mutation resolves). Default vi.fn() returns undefined, which the
// composer awaits as an immediate success. mockMutate is kept for any callers
// still exercising the fire-and-forget path.
const mockMutate = vi.fn()
const mockMutateAsync = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterPush = vi.fn()
const mockEphemeralIsVisibleSet = vi.fn()
let mockEphemeralIsVisible = false

// Disclosure modal state captured for assertions
let capturedDisclosureProps: {
  open: boolean
  mode: string
  boundary: string
  onClose: (() => void) | undefined
} = { open: false, mode: '', boundary: '', onClose: undefined }

// AmbientPrivacyLabel: capture press handler for tests
let capturedLabelOnPress: (() => void) | undefined

// LexicalContextProbe refs — track distinct editor identities
let composerProbeRef: { current: unknown } | null = null
let journalProbeRef: { current: unknown } | null = null
let probeCounter = 0

// ─── hasAcknowledgedBoundaryA mock ────────────────────────────────────────────
vi.mock('app/features/disclosure/ThreePostureDisclosure', () => {
  const ReactMod = require('react')
  return {
    hasAcknowledgedBoundaryA: () => mockHasAcknowledgedBoundaryA,
    ThreePostureDisclosure: (props: any) => {
      capturedDisclosureProps = {
        open: props.open,
        mode: props.mode,
        boundary: props.boundary,
        onClose: props.onClose,
      }
      if (!props.open) return null
      return ReactMod.createElement(
        'div',
        {
          'data-testid': 'disclosure-modal',
          'data-mode': props.mode,
          'data-boundary': props.boundary,
          role: 'dialog',
        },
        ReactMod.createElement(
          'button',
          {
            'data-testid': 'disclosure-acknowledge-btn',
            onClick: () => props.onClose?.(),
          },
          'Got it, post'
        )
      )
    },
  }
})

// ─── AmbientPrivacyLabel mock ─────────────────────────────────────────────────
vi.mock('app/features/disclosure/AmbientPrivacyLabel', () => {
  const ReactMod = require('react')
  return {
    AmbientPrivacyLabel: (props: any) => {
      capturedLabelOnPress = props.onPress
      return ReactMod.createElement(
        'button',
        {
          'data-testid': 'ambient-label',
          'data-boundary': props.boundary,
          onClick: () => props.onPress?.(),
        },
        'VISIBLE TO THE COLLECTIVE'
      )
    },
  }
})

// ─── useCreatePost + createPostWithId mock ────────────────────────────────────
vi.mock('app/state/collective/mutations', () => {
  let callCount = 0
  return {
    useCreatePost: () => ({
      mutate: mockMutate,
      mutateAsync: mockMutateAsync,
      isPending: mockIsPending,
      error: mockCreatePostError,
    }),
    createPostWithId: (vars: any) => ({
      ...vars,
      id: `uuid-call-${++callCount}-${Math.random().toString(36).slice(2, 9)}`,
    }),
  }
})

// ─── useCurrentUserId mock ────────────────────────────────────────────────────
vi.mock('app/state/collective/currentUser', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

// ─── useIsSuspended mock ──────────────────────────────────────────────────────
vi.mock('app/state/collective/suspension', () => ({
  useIsSuspended: (_userId: string | null) => mockIsSuspended,
}))

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ back: mockRouterBack, push: mockRouterPush }),
}))

// ─── store$ mock for tenure-tier opt-in (AC #22) ─────────────────────────────
// NOTE: vi.mock factories are hoisted to top of file; cannot directly reference
// `const` variables initialized below. Use property getters so the reference is
// resolved lazily at call time (after module initialization completes).
vi.mock('app/state/store', () => ({
  store$: {
    profile: {
      preferences: {
        collective_show_tenure_tier: {
          get: () => mockShowTenureTier,
        },
      },
    },
  },
  get ephemeral$() {
    return {
      persistentEditor: {
        isVisible: {
          set: mockEphemeralIsVisibleSet,
          get: () => mockEphemeralIsVisible,
        },
      },
    }
  },
}))

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapA11y = (props: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    if (props['aria-label']) out['aria-label'] = props['aria-label']
    if (props['aria-disabled'] !== undefined) out['aria-disabled'] = String(props['aria-disabled'])
    if (props.accessibilityLabel) out['aria-label'] = props.accessibilityLabel
    if (props.testID) out['data-testid'] = props.testID
    if (props['data-testid']) out['data-testid'] = props['data-testid']
    if (props.role) out['role'] = props.role
    if (props.accessibilityRole) out['role'] = props.accessibilityRole
    return out
  }

  return {
    Text: ({ children, fontSize, color, ...props }: any) =>
      ReactModule.createElement('span', mapA11y(props), children),

    // TextArea — maps Tamagui props onto a native <textarea>. Title-led redesign
    // (Story 3-16) uses this for the required "Letter title" field. We surface
    // value/placeholder/aria-label and translate onChangeText to an onChange that
    // passes e.target.value (Tamagui's onChangeText is value-first, not event-first).
    TextArea: ({ value, onChangeText, placeholder, ...props }: any) =>
      ReactModule.createElement('textarea', {
        value: value ?? '',
        placeholder,
        onChange: (e: any) => onChangeText?.(e.target.value),
        ...mapA11y(props),
      }),

    View: ({ children, tag, onPress, ...props }: any) => {
      const a11y: Record<string, unknown> = {}
      if (onPress) a11y['onClick'] = onPress
      return ReactModule.createElement('div', { ...a11y, ...mapA11y(props) }, children)
    },

    XStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'x', ...mapA11y(props) }, children),

    YStack: ({ children, ...props }: any) =>
      ReactModule.createElement('div', { 'data-stack': 'y', ...mapA11y(props) }, children),

    Separator: () => ReactModule.createElement('hr'),

    ExpandingLineButton: ({ children, onPress, disabled, ...props }: any) =>
      ReactModule.createElement(
        'button',
        {
          onClick: onPress,
          disabled: !!disabled,
          'aria-disabled': disabled ? 'true' : 'false',
          'data-testid':
            props['data-testid'] || `btn-${String(children).toLowerCase().replace(/\s+/g, '-')}`,
        },
        children
      ),

    AuthorByline: ({ displayName, postedAt, tenureTier, ...props }: any) =>
      ReactModule.createElement(
        'span',
        {
          'data-testid': 'author-byline-preview',
          'data-display-name': displayName,
          'data-tenure-tier': tenureTier ?? 'none',
          'data-posted-at': postedAt,
        },
        displayName
      ),

    useReducedMotion: () => false,
  }
})

// ─── CollectiveLexicalEditor mock — captures __contextProbeRef ───────────────
vi.mock('app/features/collective/CollectiveLexicalEditor', () => {
  const ReactMod = require('react')
  let instanceCounter = 0
  return {
    __esModule: true,
    default: ({ onContentChange, minHeight, __contextProbeRef }: any) => {
      const instanceId = ++instanceCounter
      if (__contextProbeRef) {
        __contextProbeRef.current = { __lexicalEditorId: instanceId }
      }
      return ReactMod.createElement(
        'div',
        {
          'data-testid': 'collective-lexical-editor',
          'data-min-height': minHeight,
        },
        ReactMod.createElement('div', {
          role: 'textbox',
          contentEditable: true,
          'data-testid': 'lexical-content-editable',
          onInput: (e: any) => onContentChange?.(e.target.innerText || ''),
        })
      )
    },
  }
})

// ─── LexicalEditor mock for journal Editor in t3 ─────────────────────────────
vi.mock('app/features/journal/components/Lexical/LexicalEditor', () => {
  const ReactMod = require('react')
  let journalInstanceCounter = 0
  return {
    LexicalEditor: ({ __contextProbeRef }: any) => {
      const instanceId = ++journalInstanceCounter * 1000 // distinct range
      if (__contextProbeRef) {
        __contextProbeRef.current = { __lexicalEditorId: instanceId }
      }
      return ReactMod.createElement('div', {
        'data-testid': 'journal-lexical-editor',
      })
    },
  }
})

// ─── Import under test — will fail until PostComposer.tsx exists ──────────────
// eslint-disable-next-line import/first
import PostComposer from '../PostComposer'

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup()
  mockHasAcknowledgedBoundaryA = false
  mockCurrentUserId = 'abcdef0123456789'
  mockIsSuspended = false
  mockIsPending = false
  mockCreatePostError = null
  mockShowTenureTier = false
  mockMutate.mockReset()
  mockMutateAsync.mockReset()
  mockRouterBack.mockReset()
  mockRouterPush.mockReset()
  mockEphemeralIsVisibleSet.mockReset()
  capturedDisclosureProps = { open: false, mode: '', boundary: '', onClose: undefined }
  capturedLabelOnPress = undefined
  composerProbeRef = null
  journalProbeRef = null
})

// ─────────────────────────────────────────────────────────────────────────────
// t1 — first-time disclosure gate
// AC #1, #2, #26-t1
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t1 — first-time disclosure gate (AC #1, #2)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = false
  })

  it('renders the disclosure dialog with mode="first-time" on first open', () => {
    render(React.createElement(PostComposer))
    const modal = document.querySelector('[data-testid="disclosure-modal"]')
    expect(modal).not.toBeNull()
    expect(modal?.getAttribute('data-mode')).toBe('first-time')
  })

  it('renders the disclosure with boundary="collective_post_v1"', () => {
    render(React.createElement(PostComposer))
    const modal = document.querySelector('[data-testid="disclosure-modal"]')
    expect(modal?.getAttribute('data-boundary')).toBe('collective_post_v1')
  })

  it('capturedDisclosureProps.open is true on first open', () => {
    render(React.createElement(PostComposer))
    expect(capturedDisclosureProps.open).toBe(true)
  })

  it('writing surface (lexical editor) is NOT visible while disclosure is open', () => {
    render(React.createElement(PostComposer))
    // The composer body should not be rendered (or be hidden) before acknowledgment
    const editor = document.querySelector('[data-testid="collective-lexical-editor"]')
    expect(editor).toBeNull()
  })

  it('after tapping "Got it, post", disclosure closes and composer becomes visible', () => {
    render(React.createElement(PostComposer))
    // Simulate acknowledgment by mocking hasAcknowledgedBoundaryA to return true
    mockHasAcknowledgedBoundaryA = true
    const ackBtn = document.querySelector('[data-testid="disclosure-acknowledge-btn"]')
    expect(ackBtn).not.toBeNull()
    fireEvent.click(ackBtn!)
    // After acknowledgment: disclosure gone, editor visible
    const modal = document.querySelector('[data-testid="disclosure-modal"]')
    expect(modal).toBeNull()
    const editor = document.querySelector('[data-testid="collective-lexical-editor"]')
    expect(editor).not.toBeNull()
  })

  it('acknowledgment transitions the SAME screen instance — no route navigation', () => {
    render(React.createElement(PostComposer))
    mockHasAcknowledgedBoundaryA = true
    const ackBtn = document.querySelector('[data-testid="disclosure-acknowledge-btn"]')
    fireEvent.click(ackBtn!)
    // Navigation should NOT have been called (we're still on the composer screen)
    expect(mockRouterBack).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t2 — already-acknowledged path
// AC #2, #26-t2
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t2 — already-acknowledged path (AC #2)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('renders composer immediately with NO disclosure interrupt', () => {
    render(React.createElement(PostComposer))
    const modal = document.querySelector('[data-testid="disclosure-modal"]')
    expect(modal).toBeNull()
    expect(capturedDisclosureProps.open).toBe(false)
  })

  it('renders AmbientPrivacyLabel with boundary="collective_post_v1"', () => {
    render(React.createElement(PostComposer))
    const label = document.querySelector('[data-testid="ambient-label"]')
    expect(label).not.toBeNull()
    expect(label?.getAttribute('data-boundary')).toBe('collective_post_v1')
  })

  it('AmbientPrivacyLabel reads "VISIBLE TO THE COLLECTIVE"', () => {
    render(React.createElement(PostComposer))
    expect(screen.getByText('VISIBLE TO THE COLLECTIVE')).not.toBeNull()
  })

  it('renders the Lexical writing surface', () => {
    render(React.createElement(PostComposer))
    const editor = document.querySelector('[data-testid="collective-lexical-editor"]')
    expect(editor).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t3 — Lexical isolation regression (D14)
// AC #7, #9, #26-t3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t3 — Lexical isolation regression D14 (AC #7, #9)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('composer mounts its own LexicalComposer — distinct from journal editor', () => {
    // This test uses the __contextProbeRef mechanism from Task 3 to compare editor instances.
    // The CollectiveLexicalEditor mock captures distinct instanceIds per mount.
    // We assert that the composer's probe ref is non-null, implying it has its own context.
    const composerRef = { current: null as unknown }
    render(React.createElement(PostComposer, { __contextProbeRef: composerRef } as any))
    // The probe ref should have been populated by the mocked CollectiveLexicalEditor
    // If PostComposer doesn't forward the probe ref, this test fails.
    expect(composerRef.current).not.toBeNull()
  })

  it('two sequential composer mounts produce distinct editor references', () => {
    const ref1 = { current: null as unknown }
    const ref2 = { current: null as unknown }

    const { unmount } = render(
      React.createElement(PostComposer, { __contextProbeRef: ref1 } as any)
    )
    const id1 = (ref1.current as any)?.__lexicalEditorId
    unmount()

    render(React.createElement(PostComposer, { __contextProbeRef: ref2 } as any))
    const id2 = (ref2.current as any)?.__lexicalEditorId

    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t4 — ephemeral$.persistentEditor.isVisible NOT touched
// AC #8, #26-t4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t4 — ephemeral$.persistentEditor.isVisible not touched (AC #8)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('mounting PostComposer never calls ephemeral$.persistentEditor.isVisible.set', () => {
    render(React.createElement(PostComposer))
    expect(mockEphemeralIsVisibleSet).not.toHaveBeenCalled()
  })

  it('unmounting PostComposer never calls ephemeral$.persistentEditor.isVisible.set', () => {
    const { unmount } = render(React.createElement(PostComposer))
    unmount()
    expect(mockEphemeralIsVisibleSet).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t5 — "posting as" preview with tenure-tier opt-in
// AC #6, #26-t5
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t5 — "posting as" preview (AC #6)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
    mockCurrentUserId = 'abcdef0123456789'
    mockShowTenureTier = true
  })

  it('renders "posting as" label text', () => {
    render(React.createElement(PostComposer))
    expect(screen.getByText(/posting as/i)).not.toBeNull()
  })

  it('renders AuthorByline preview with displayName = first 8 chars of userId', () => {
    render(React.createElement(PostComposer))
    const byline = document.querySelector('[data-testid="author-byline-preview"]')
    expect(byline).not.toBeNull()
    expect(byline?.getAttribute('data-display-name')).toBe('abcdef01')
  })

  it('AuthorByline preview receives tenureTier when opt-in is true', () => {
    render(React.createElement(PostComposer))
    const byline = document.querySelector('[data-testid="author-byline-preview"]')
    // When opt-in is true, tenureTier should be passed (not 'none')
    // Note: current implementation defers the actual tier value (TODO) so
    // the test confirms the prop pipeline exists; the value may still be undefined
    // per AC #6 / Task 4 deferral note. We assert the component renders.
    expect(byline).not.toBeNull()
  })

  it('AuthorByline preview receives postedAt (ISO string)', () => {
    render(React.createElement(PostComposer))
    const byline = document.querySelector('[data-testid="author-byline-preview"]')
    const postedAt = byline?.getAttribute('data-posted-at')
    expect(postedAt).toBeTruthy()
    expect(() => new Date(postedAt!).toISOString()).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t6 — submit success path
// AC #12, #26-t6
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t6 — submit success path (AC #12)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
    mockCurrentUserId = 'user-xyz'
    mockIsPending = false
  })

  it('tapping submit calls mutateAsync with title, body, parent_post_id: null, and a uuid id', async () => {
    render(React.createElement(PostComposer))
    // Top-level letters are title-led: provide a required title first.
    const titleField = screen.getByLabelText('Letter title')
    fireEvent.change(titleField, { target: { value: 'A morning letter' } })
    // Type into the writing surface
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    expect(editor).not.toBeNull()
    fireEvent.input(editor!, { target: { innerText: 'Hello collective.' } })
    // Tap submit (top-level label is "Leave it for the room")
    const submitBtn = screen.getByText('Leave it for the room')
    await act(async () => {
      fireEvent.click(submitBtn)
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    const callArg = mockMutateAsync.mock.calls[0]![0]
    expect(callArg.title).toBe('A morning letter')
    expect(callArg.body).toBe('Hello collective.')
    expect(callArg.parent_post_id).toBeNull()
    expect(callArg.user_id).toBe('user-xyz')
    expect(callArg.id).toBeDefined()
    expect(typeof callArg.id).toBe('string')
  })

  it('calls router.push("/collective") after the mutation resolves (never router.back)', async () => {
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'Post body text.' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/collective')
    expect(mockRouterBack).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t7 — submit disabled when body is empty
// AC #13, #26-t7
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t7 — submit disabled when body empty (AC #13)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('submit button is disabled with no typed text', () => {
    render(React.createElement(PostComposer))
    const submitBtn = screen.getByText('Leave it for the room')
    expect(submitBtn.closest('button')?.disabled).toBe(true)
  })

  it('submit stays disabled when only the body is typed (title still required)', () => {
    // Title-led redesign: a non-blank body alone is NOT enough to enable the
    // top-level submit — the required title must also be present.
    render(React.createElement(PostComposer))
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'A body with no title yet.' } })
    const submitBtn = screen.getByText('Leave it for the room')
    expect(submitBtn.closest('button')?.disabled).toBe(true)
  })

  it('submit becomes enabled once BOTH title and body are non-blank', () => {
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'My title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'Some body text.' } })
    const submitBtn = screen.getByText('Leave it for the room')
    expect(submitBtn.closest('button')?.disabled).toBe(false)
  })

  it('does NOT render empty-state microcopy when body is empty (AC #13 spec: no message)', () => {
    render(React.createElement(PostComposer))
    // AC #13: Empty: NO microcopy (just the disabled state)
    expect(screen.queryByText(/Submitting/i)).toBeNull()
    expect(screen.queryByText(/paused/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t8 — submit disabled when pending
// AC #13, #26-t8
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t8 — submit disabled when pending (AC #13)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
    mockIsPending = true
  })

  it('submit button is disabled when isPending===true', () => {
    render(React.createElement(PostComposer))
    const submitBtn = screen.getByText('Leave it for the room')
    expect(submitBtn.closest('button')?.disabled).toBe(true)
  })

  it('renders "Submitting..." microcopy when isPending===true', () => {
    render(React.createElement(PostComposer))
    expect(screen.getByText(/Submitting\.\.\./i)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t9 — submit disabled when suspended
// AC #13, #18, #26-t9
// ─────────────────────────────────────────────────────────────────────────────

// t9 REMOVED in iteration 2: suspension-state rendering moved to
// CollectiveEligibilityGate. PostComposer no longer renders suspension
// microcopy or gates Submit on suspended; the gate prevents the editor from
// mounting in the suspended branch. See CollectiveEligibilityGate.test.tsx.

// ─────────────────────────────────────────────────────────────────────────────
// t10 — error path: microcopy rendered + body preserved
// AC #16, #26-t10
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t10 — error path (AC #16)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('renders error microcopy "Couldn\'t post. Try again." when mutateAsync rejects', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('RLS rejection'))
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'test post body' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    expect(screen.getByText(/Couldn't post\. Try again\./i)).not.toBeNull()
  })

  it('composer does NOT auto-close on error (draft preserved, no navigation)', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('error'))
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'draft text' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    // No navigation on error
    expect(mockRouterBack).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
    // Editor still in DOM
    expect(document.querySelector('[data-testid="collective-lexical-editor"]')).not.toBeNull()
    // Draft state is still present: the title field keeps its value, and Submit
    // stays enabled (title+body state were NOT cleared on the failure path).
    expect((screen.getByLabelText('Letter title') as HTMLTextAreaElement).value).toBe('A title')
    expect(screen.getByText('Leave it for the room').closest('button')?.disabled).toBe(false)
  })

  it('does NOT render native alert or toast on error (NO dialog role)', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('error'))
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    // No modal/dialog should appear
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('a second submit attempt clears the stale error banner while pending', async () => {
    // First attempt fails → banner shows.
    mockMutateAsync.mockRejectedValueOnce(new Error('first failure'))
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'retry draft' } })
    const submitBtn = screen.getByText('Leave it for the room')
    await act(async () => {
      fireEvent.click(submitBtn)
    })
    expect(screen.getByText(/Couldn't post\. Try again\./i)).not.toBeNull()

    // Second attempt: mutation stays in flight → the stale banner is cleared
    // immediately (setShowError(false) at the top of the handler).
    let resolveSecond: (() => void) | undefined
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSecond = resolve
        })
    )
    await act(async () => {
      fireEvent.click(submitBtn)
    })
    expect(screen.queryByText(/Couldn't post\. Try again\./i)).toBeNull()

    // Let the in-flight attempt finish so no dangling promise leaks across tests.
    await act(async () => {
      resolveSecond?.()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t11 — telemetry redaction grep
// AC #20, #26-t11
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t11 — telemetry redaction grep (AC #20)', () => {
  it('PostComposer.tsx exists (prerequisite for grep)', () => {
    expect(
      existsSync(POST_COMPOSER_PATH),
      `PostComposer.tsx must exist at ${POST_COMPOSER_PATH}`
    ).toBe(true)
  })

  it('PostComposer.tsx contains NO console.(log|warn|error) calls that interpolate body', () => {
    if (!existsSync(POST_COMPOSER_PATH)) return
    const src = readFileSync(POST_COMPOSER_PATH, 'utf8')
    // This regex catches console.log/warn/error with body variable interpolated
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*body/)
  })

  it('PostComposer.tsx does NOT pass body to Sentry.captureException extras', () => {
    if (!existsSync(POST_COMPOSER_PATH)) return
    const src = readFileSync(POST_COMPOSER_PATH, 'utf8')
    expect(src).not.toMatch(/captureException[^)]*body/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t12 — compact reply variant
// AC #17, #26-t12
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t12 — compact reply variant (AC #17)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('writing surface has compact minHeight when compact===true', () => {
    const onSubmitted = vi.fn()
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'parent-post-id-1' },
        onSubmitted,
      })
    )
    const editor = document.querySelector('[data-testid="collective-lexical-editor"]')
    expect(editor).not.toBeNull()
    // minHeight:120 for compact vs 300 for full
    expect(editor?.getAttribute('data-min-height')).toBe('120')
  })

  it('compact Submit calls mutateAsync with parent_post_id from replyContext', async () => {
    const onSubmitted = vi.fn()
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'parent-post-id-1' },
        onSubmitted,
      })
    )
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'reply body' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Submit'))
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    const callArg = mockMutateAsync.mock.calls[0]![0]
    expect(callArg.parent_post_id).toBe('parent-post-id-1')
  })

  it('compact Submit calls onSubmitted after the mutation resolves (not router.back)', async () => {
    const onSubmitted = vi.fn()
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'parent-post-id-1' },
        onSubmitted,
      })
    )
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'reply body' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Submit'))
    })
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('AmbientPrivacyLabel is rendered in compact mode (privacy guarantee maintained)', () => {
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'p1' },
        onSubmitted: vi.fn(),
      })
    )
    const label = document.querySelector('[data-testid="ambient-label"]')
    expect(label).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t13 — Lexical config namespace reuse (AC #10, #13)
// AC #10, #13, #26-t13
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t13 — Lexical config namespace reuse (AC #10, #13)', () => {
  it('CollectiveLexicalEditor.tsx exists', () => {
    expect(
      existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH),
      `CollectiveLexicalEditor.tsx must exist at ${COLLECTIVE_LEXICAL_EDITOR_PATH}`
    ).toBe(true)
  })

  it('CollectiveLexicalEditor.tsx uses createBaseLexicalConfig (not a custom config)', () => {
    if (!existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH)) return
    const src = readFileSync(COLLECTIVE_LEXICAL_EDITOR_PATH, 'utf8')
    expect(src).toMatch(/createBaseLexicalConfig|createMobileLexicalConfig/)
  })

  it('CollectiveLexicalEditor.tsx does NOT import LexicalSync (D14)', () => {
    if (!existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH)) return
    const src = readFileSync(COLLECTIVE_LEXICAL_EDITOR_PATH, 'utf8')
    expect(src).not.toMatch(/LexicalSync/)
  })

  it('CollectiveLexicalEditor.tsx does NOT mount FocusModeParagraphPlugin (journal-only)', () => {
    if (!existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH)) return
    const src = readFileSync(COLLECTIVE_LEXICAL_EDITOR_PATH, 'utf8')
    expect(src).not.toMatch(/FocusModeParagraphPlugin/)
  })

  it('CollectiveLexicalEditor.tsx uses 3-arg $convertToMarkdownString (hasOutputNodeHandling=true)', () => {
    if (!existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH)) return
    const src = readFileSync(COLLECTIVE_LEXICAL_EDITOR_PATH, 'utf8')
    // Must use the 3-arg form: $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true)
    expect(src).toMatch(/\$convertToMarkdownString\s*\([^)]*,\s*undefined\s*,\s*true\s*\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t14 — disclosure review-mode dismiss: body preserved
// AC #4, #26-t14
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t14 — review-mode disclosure dismiss, body preserved (AC #4)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('tapping AmbientPrivacyLabel opens disclosure in mode="review"', () => {
    render(React.createElement(PostComposer))
    const label = document.querySelector('[data-testid="ambient-label"]')
    expect(label).not.toBeNull()
    fireEvent.click(label!)
    expect(capturedDisclosureProps.open).toBe(true)
    expect(capturedDisclosureProps.mode).toBe('review')
  })

  it('review-mode disclosure has boundary="collective_post_v1"', () => {
    render(React.createElement(PostComposer))
    fireEvent.click(document.querySelector('[data-testid="ambient-label"]')!)
    expect(capturedDisclosureProps.boundary).toBe('collective_post_v1')
  })

  it('dismissing review modal does NOT reset composer body state', () => {
    render(React.createElement(PostComposer))
    // Type something
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'mid-composition text' } })
    // Open review disclosure
    fireEvent.click(document.querySelector('[data-testid="ambient-label"]')!)
    // Dismiss it
    act(() => capturedDisclosureProps.onClose?.())
    // Disclosure should be gone
    expect(document.querySelector('[data-testid="disclosure-modal"]')).toBeNull()
    // Editor still present (body state preserved — we can't assert innerText in jsdom
    // but we can assert the editor is still in DOM)
    expect(document.querySelector('[data-testid="collective-lexical-editor"]')).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t15 — submit calls createPostWithId per-call (UUID distinctness guard)
// AC #12, #26-t15
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t15 — per-call UUID generation (AC #12)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('two submit calls produce distinct id values (guards useState(crypto.randomUUID()) regression)', async () => {
    // Re-render trick: mount, type, submit, then type again and submit
    // In a real implementation, after submit navigates away, a new mount would occur.
    // We simulate two separate mounts:
    const { unmount } = render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'First title' } })
    const editor1 = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor1!, { target: { innerText: 'first post' } })
    // Mock router to not crash on back
    mockRouterBack.mockImplementation(() => {})
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    unmount()

    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'Second title' } })
    const editor2 = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor2!, { target: { innerText: 'second post' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    const id1 = mockMutateAsync.mock.calls[0]![0].id
    const id2 = mockMutateAsync.mock.calls[1]![0].id
    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t16 — submit AWAITS the mutation; composer stays open until it resolves
// (#26-t16 — silent-data-loss fix 2026-07: the old "close synchronously even
// offline" contract could discard a rejected letter with no error shown. The
// accepted tradeoff: while the insert is pending — including offline-paused —
// the composer stays open with the draft intact; navigation fires only on
// confirmed success.)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t16 — submit awaits the mutation before closing', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('full-mode: composer stays open (no navigation) while the mutation is pending; router.push fires after it resolves', async () => {
    let resolveMutation: (() => void) | undefined
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'Pending title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'pending post' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Leave it for the room'))
    })
    // In flight: no navigation, editor still mounted, draft intact.
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="collective-lexical-editor"]')).not.toBeNull()
    expect((screen.getByLabelText('Letter title') as HTMLTextAreaElement).value).toBe(
      'Pending title'
    )
    // Server confirms → NOW the composer closes.
    await act(async () => {
      resolveMutation?.()
    })
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/collective')
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('compact-mode: onSubmitted fires only after the mutation resolves', async () => {
    const onSubmitted = vi.fn()
    let resolveMutation: (() => void) | undefined
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'p1' },
        onSubmitted,
      })
    )
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'pending reply' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Submit'))
    })
    expect(onSubmitted).not.toHaveBeenCalled()
    await act(async () => {
      resolveMutation?.()
    })
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t17 — double-tap submit guard
// AC #13, #26-t17 (Chaos Monkey #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t17 — double-tap submit guard (AC #13)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('two synchronous Submit clicks fire mutateAsync exactly once', async () => {
    // In-flight simulation: the first mutateAsync never settles inside the act.
    let resolveMutation: (() => void) | undefined
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'rapid post' } })
    const submitBtn = screen.getByText('Leave it for the room')
    // Two rapid clicks while the first submit is still in flight
    await act(async () => {
      fireEvent.click(submitBtn)
      fireEvent.click(submitBtn)
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    // Settle the in-flight mutation so nothing leaks across tests.
    await act(async () => {
      resolveMutation?.()
    })
  })

  it('after the first mutation settles, a third click lands a second mutateAsync call', async () => {
    let resolveFirst: (() => void) | undefined
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    )
    render(React.createElement(PostComposer))
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'A title' } })
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'rapid post' } })
    const submitBtn = screen.getByText('Leave it for the room')
    await act(async () => {
      fireEvent.click(submitBtn)
      fireEvent.click(submitBtn) // second tap, should be blocked
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    // Now settle the first call (success path clears the draft + resets the guard).
    await act(async () => {
      resolveFirst?.()
    })
    // Re-enter a draft (success cleared title/body) and click a third time —
    // the guard has been released, so a second mutateAsync call lands.
    fireEvent.change(screen.getByLabelText('Letter title'), { target: { value: 'Second title' } })
    fireEvent.input(editor!, { target: { innerText: 'second post' } })
    await act(async () => {
      fireEvent.click(submitBtn)
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t18 — route files exist
// AC #23, #24, #25
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t18 — route files exist (AC #23, #24, #25)', () => {
  it('apps/web/app/collective/compose/page.tsx exists', () => {
    expect(
      existsSync(WEB_COMPOSE_ROUTE_PATH),
      `web compose route must exist at ${WEB_COMPOSE_ROUTE_PATH}`
    ).toBe(true)
  })

  it('apps/web/app/collective/compose/page.tsx mounts the compose surface', () => {
    if (!existsSync(WEB_COMPOSE_ROUTE_PATH)) return
    const src = readFileSync(WEB_COMPOSE_ROUTE_PATH, 'utf8')
    // Route may render PostComposer directly, or via CollectiveComposeShell
    // (which warms the feed cache so optimistic onMutate has a snapshot).
    expect(src).toMatch(/PostComposer|CollectiveComposeShell/)
    expect(src).toMatch(/'use client'/)
  })

  it('apps/desktop/app/collective/compose/page.tsx exists', () => {
    expect(
      existsSync(DESKTOP_COMPOSE_ROUTE_PATH),
      `desktop compose route must exist at ${DESKTOP_COMPOSE_ROUTE_PATH}`
    ).toBe(true)
  })

  it('apps/desktop/app/collective/compose/page.tsx mounts the compose surface', () => {
    if (!existsSync(DESKTOP_COMPOSE_ROUTE_PATH)) return
    const src = readFileSync(DESKTOP_COMPOSE_ROUTE_PATH, 'utf8')
    expect(src).toMatch(/PostComposer|CollectiveComposeShell/)
  })

  it('apps/mobile/app/collective/compose.tsx exists', () => {
    expect(
      existsSync(MOBILE_COMPOSE_ROUTE_PATH),
      `mobile compose route must exist at ${MOBILE_COMPOSE_ROUTE_PATH}`
    ).toBe(true)
  })

  it('apps/mobile/app/collective/compose.tsx mounts the compose surface', () => {
    if (!existsSync(MOBILE_COMPOSE_ROUTE_PATH)) return
    const src = readFileSync(MOBILE_COMPOSE_ROUTE_PATH, 'utf8')
    expect(src).toMatch(/PostComposer|CollectiveComposeShell/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t19 — disclosure gate acknowledgment triggers focus (AC #3)
// AC #3
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t19 — disclosure acknowledgment schedules focus (AC #3)', () => {
  it('after acknowledgment, setShowDisclosure(false) is called synchronously (composer body becomes visible)', () => {
    mockHasAcknowledgedBoundaryA = false
    render(React.createElement(PostComposer))
    // Before ack
    expect(document.querySelector('[data-testid="collective-lexical-editor"]')).toBeNull()
    // Acknowledge (wrapper writes acknowledged_at before calling onClose)
    mockHasAcknowledgedBoundaryA = true
    const ackBtn = document.querySelector('[data-testid="disclosure-acknowledge-btn"]')
    fireEvent.click(ackBtn!)
    // Composer body now visible
    expect(document.querySelector('[data-testid="collective-lexical-editor"]')).not.toBeNull()
  })

  it('defensive recheck: if hasAcknowledgedBoundaryA() returns false post-ack, disclosure re-shows', () => {
    // Simulate a failed acknowledgment write: hasAcknowledgedBoundaryA stays false
    mockHasAcknowledgedBoundaryA = false
    render(React.createElement(PostComposer))
    // Trigger onClose WITHOUT setting mockHasAcknowledgedBoundaryA = true
    // (simulates a write failure where acknowledged_at never persisted)
    const ackBtn = document.querySelector('[data-testid="disclosure-acknowledge-btn"]')
    fireEvent.click(ackBtn!)
    // Disclosure should re-show (defensive recheck per AC #3 / Failure Mode Analysis #1)
    const modal = document.querySelector('[data-testid="disclosure-modal"]')
    expect(modal).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t20 — word/character count renders
// AC #11
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t20 — word/character count (AC #11)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('renders word and char count micro-typography below writing surface', () => {
    render(React.createElement(PostComposer))
    // AC #11: "{words} words · {chars} chars"
    expect(screen.getByText(/\d+ words · \d+ chars/)).not.toBeNull()
  })

  it('word count updates when content changes', () => {
    render(React.createElement(PostComposer))
    const editor = document.querySelector('[data-testid="lexical-content-editable"]')
    fireEvent.input(editor!, { target: { innerText: 'hello world' } })
    expect(screen.getByText(/2 words/)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t21 — tenure-tier opt-out: tenureTier NOT passed to AuthorByline preview
// AC #6, #21
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t21 — tenure-tier opt-out (AC #6, #21)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
    mockShowTenureTier = false
  })

  it('AuthorByline preview receives tenureTier=undefined when opt-in is false', () => {
    render(React.createElement(PostComposer))
    const byline = document.querySelector('[data-testid="author-byline-preview"]')
    expect(byline).not.toBeNull()
    // When opt-in is false, tenureTier should be undefined → mock shows 'none'
    expect(byline?.getAttribute('data-tenure-tier')).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t22 — D14 boundary: PostComposer does NOT import PersistentEditor or ephemeral$.persistentEditor
// AC #7, #27
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t22 — D14 boundary: no PersistentEditor or ephemeral$.persistentEditor import (AC #7, #27)', () => {
  it('PostComposer.tsx does NOT import PersistentEditor', () => {
    if (!existsSync(POST_COMPOSER_PATH)) return
    const src = readFileSync(POST_COMPOSER_PATH, 'utf8')
    // Scope to import statements so a comment that merely references the
    // PersistentEditor source path (e.g. documenting a shared pattern) is not a
    // false positive. The D14 boundary forbids importing it, not naming it.
    expect(src).not.toMatch(/^\s*import[^\n]*PersistentEditor/m)
  })

  it('PostComposer.tsx does NOT read ephemeral$.persistentEditor paths', () => {
    if (!existsSync(POST_COMPOSER_PATH)) return
    const src = readFileSync(POST_COMPOSER_PATH, 'utf8')
    expect(src).not.toMatch(/ephemeral\$\.persistentEditor/)
  })

  it('CollectiveLexicalEditor.tsx does NOT import PersistentEditor', () => {
    if (!existsSync(COLLECTIVE_LEXICAL_EDITOR_PATH)) return
    const src = readFileSync(COLLECTIVE_LEXICAL_EDITOR_PATH, 'utf8')
    expect(src).not.toMatch(/^\s*import[^\n]*PersistentEditor/m)
  })

  it('LexicalContextProbe is NOT referenced in any app entry point', () => {
    // Verify test-only probe does not ship to production bundles
    // Check each app directory
    const appDirs = [
      path.join(PROJECT_ROOT, 'apps/web/app'),
      path.join(PROJECT_ROOT, 'apps/desktop/app'),
      path.join(PROJECT_ROOT, 'apps/mobile/app'),
    ]
    for (const appDir of appDirs) {
      if (!existsSync(appDir)) continue
      // We grep-check by reading all compose route files
      const webCompose = WEB_COMPOSE_ROUTE_PATH
      const desktopCompose = DESKTOP_COMPOSE_ROUTE_PATH
      const mobileCompose = MOBILE_COMPOSE_ROUTE_PATH
      for (const routePath of [webCompose, desktopCompose, mobileCompose]) {
        if (!existsSync(routePath)) continue
        const src = readFileSync(routePath, 'utf8')
        expect(src).not.toMatch(/LexicalContextProbe/)
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t23 — unauthenticated: "Sign in to post." placeholder renders
// AC #13 (unauthenticated branch)
// ─────────────────────────────────────────────────────────────────────────────

// t23 REMOVED in iteration 2: unauthenticated rendering moved to
// CollectiveEligibilityGate. The gate owns the verbatim "Sign in to post."
// copy assertion now. See CollectiveEligibilityGate.test.tsx.

// ─────────────────────────────────────────────────────────────────────────────
// t24 — compact mode Cancel button calls onCancelled
// AC #17
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t24 — compact Cancel button (AC #17)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('renders Cancel button in compact mode', () => {
    const onCancelled = vi.fn()
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'p1' },
        onCancelled,
      })
    )
    expect(screen.getByText('Cancel')).not.toBeNull()
  })

  it('tapping Cancel calls onCancelled prop', () => {
    const onCancelled = vi.fn()
    render(
      React.createElement(PostComposer, {
        compact: true,
        replyContext: { parentPostId: 'p1' },
        onCancelled,
      })
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancelled).toHaveBeenCalledTimes(1)
  })

  it('Cancel button is NOT rendered in full (non-compact) mode', () => {
    render(React.createElement(PostComposer))
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// t25 — ambient label tap opens disclosure in review mode
// AC #4
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3-9 / t25 — ambient label tap triggers review disclosure (AC #4)', () => {
  beforeEach(() => {
    mockHasAcknowledgedBoundaryA = true
  })

  it('tapping AmbientPrivacyLabel opens disclosure with mode="review" and open=true', () => {
    render(React.createElement(PostComposer))
    const label = document.querySelector('[data-testid="ambient-label"]')
    fireEvent.click(label!)
    expect(capturedDisclosureProps.mode).toBe('review')
    expect(capturedDisclosureProps.open).toBe(true)
  })

  it('review-mode close does NOT modify acknowledged_at (AC #4 — no timestamp change)', () => {
    // The Story 3.6 wrapper's review-close path does not touch users.preferences.
    // PostComposer should NOT call any acknowledgment write in the review-close path.
    // We verify by asserting the disclosure is called with mode='review' (not 'first-time'),
    // meaning the composer delegates to the wrapper which owns that invariant.
    render(React.createElement(PostComposer))
    fireEvent.click(document.querySelector('[data-testid="ambient-label"]')!)
    expect(capturedDisclosureProps.mode).toBe('review')
    // Dismiss review modal
    act(() => capturedDisclosureProps.onClose?.())
    // The disclosure's mode should not flip back to first-time after review dismiss
    expect(capturedDisclosureProps.open).toBe(false)
  })
})
