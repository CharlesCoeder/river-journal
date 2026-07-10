// @vitest-environment happy-dom
/**
 * `OnboardingSequence` (3 screens: practice / community / progression)
 *
 * E2E test covering:
 *   - component structure: 3 sequential full-screen views with the specified
 *     copy, Continue/Get started/Skip affordances
 *   - Continue transitions the next screen in via the designEnterSlow spring
 *   - Skip exits from anywhere, routing directly to home
 *   - typography-only layout (no imagery / icons anywhere)
 *   - screen-reader semantics (`section` + `h1`) and focus management
 *   - reduced-motion degrades the spring to the `100ms` fallback token
 *   - transitions are re-entrancy-safe (idempotent double-tap guards)
 *   - forward-only navigation, single primary CTA per screen, distinct
 *     onDone reasons ('completed' vs 'skipped') on Screen 3
 *
 * Mock strategy: @my/ui mocked to map Tamagui primitives to testable HTML
 * elements (honoring `tag`, forwarding `transition` as `data-transition` so
 * transition-token assertions can read it), `solito/navigation` useRouter
 * mocked with a spy. Mirrors ThreePostureDisclosure.wrapper.test.tsx /
 * CollectiveFeedScreen.test.tsx conventions used elsewhere in this codebase.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — controllable mock state
// ─────────────────────────────────────────────────────────────────────────────
const { mockReducedMotion, mockRouterPush } = vi.hoisted(() => {
  return {
    mockReducedMotion: { current: false },
    mockRouterPush: vi.fn(),
  }
})

// ─── Mock solito/navigation — spy on router.push ──────────────────────────────
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ─── Mock @my/ui — map Tamagui primitives to testable HTML elements ──────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  // Common prop → DOM attribute / handler mapping shared by Text/View/YStack/XStack.
  const mapCommon = (props: Record<string, any>) => {
    const out: Record<string, unknown> = {}
    if (props.id !== undefined) out.id = props.id
    if (props['aria-label'] !== undefined) out['aria-label'] = props['aria-label']
    if (props.accessibilityLabel !== undefined) out['aria-label'] = props.accessibilityLabel
    if (props['aria-labelledby'] !== undefined) out['aria-labelledby'] = props['aria-labelledby']
    if (props.role !== undefined) out.role = props.role
    if (props.accessibilityRole !== undefined) out.role = props.accessibilityRole
    if (props.tabIndex !== undefined) out.tabIndex = props.tabIndex
    if (props.testID !== undefined) out['data-testid'] = props.testID
    if (props['data-testid'] !== undefined) out['data-testid'] = props['data-testid']
    // Surface the `transition` prop as a DOM attribute so transition-token
    // tests can assert on the exact token ('designEnterSlow' vs '100ms')
    // without needing to inspect Tamagui internals.
    if (props.transition !== undefined) out['data-transition'] = String(props.transition)
    if (props.onPress) out.onClick = props.onPress
    return out
  }

  const Text = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'span'
    return ReactModule.createElement(htmlTag, mapCommon(props), children)
  }

  const View = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, mapCommon(props), children)
  }

  const YStack = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, { 'data-stack': 'y', ...mapCommon(props) }, children)
  }

  const XStack = ({ children, tag, ...props }: any) => {
    const htmlTag = typeof tag === 'string' ? tag : 'div'
    return ReactModule.createElement(htmlTag, { 'data-stack': 'x', ...mapCommon(props) }, children)
  }

  // AnimatePresence is a pass-through in tests (established convention —
  // HomeScreen.tsx / JournalScreen.tsx tests).
  const AnimatePresence = ({ children }: any) => children

  // Skip is a Secondary text affordance per the design system's button
  // hierarchy, not an ExpandingLineButton, so it is expected to be built
  // from Text/View with role="button". ExpandingLineButton itself is only
  // used for Continue / Get started.
  const ExpandingLineButton = ({ children, onPress, disabled, accessibilityLabel, id }: any) =>
    ReactModule.createElement(
      'button',
      {
        type: 'button',
        id,
        onClick: disabled ? undefined : onPress,
        disabled: !!disabled,
        'aria-label': accessibilityLabel ?? (typeof children === 'string' ? children : undefined),
      },
      children
    )

  return {
    Text,
    View,
    YStack,
    XStack,
    AnimatePresence,
    ExpandingLineButton,
    useReducedMotion: () => mockReducedMotion.current,
  }
})

// ─── Import under test ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { OnboardingSequence } from '../OnboardingSequence'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function flushRaf() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r))
  })
}

function getHeadline(): HTMLElement {
  return screen.getByRole('heading', { level: 1 })
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReducedMotion.current = false
  mockRouterPush.mockClear()
})

afterEach(() => {
  cleanup()
})

// =============================================================================
// Component structure: 3 sequential screens with the exact copy
// =============================================================================

describe('Screen 1 (Practice) renders first', () => {
  it('renders the Practice headline copy', () => {
    render(React.createElement(OnboardingSequence))
    expect(screen.getByText(/Write 500 words a day/i)).not.toBeNull()
    expect(screen.getByText(/Keep them private/i)).not.toBeNull()
  })

  it('renders a Continue button and a Skip affordance on Screen 1', () => {
    render(React.createElement(OnboardingSequence))
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeNull()
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeNull()
  })

  it('does NOT render "Get started" on Screen 1', () => {
    render(React.createElement(OnboardingSequence))
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull()
  })
})

describe('Continue advances Screen 1 → Screen 2 (Community)', () => {
  it('renders the Community headline copy after Continue', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/meet others doing the same/i)).not.toBeNull()
  })

  it('Screen 1 copy is gone after advancing to Screen 2', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.queryByText(/Write 500 words a day/i)).toBeNull()
  })

  it('Screen 2 still exposes Continue and Skip', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeNull()
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeNull()
  })
})

describe('Continue advances Screen 2 → Screen 3 (Progression)', () => {
  it('renders the Progression headline copy and "Get started" (Continue gone)', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 2
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 3
    expect(screen.getByText(/Sustained practice unlocks more/i)).not.toBeNull()
    expect(screen.getByRole('button', { name: /get started/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull()
  })

  it('Screen 3 still exposes Skip', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeNull()
  })
})

// =============================================================================
// Continue transitions via the designEnterSlow named spring
// =============================================================================

describe('designEnterSlow spring transition', () => {
  it('the mounted Screen 1 wrapper carries the designEnterSlow transition token', () => {
    render(React.createElement(OnboardingSequence))
    const el = document.querySelector('[data-transition]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-transition')).toBe('designEnterSlow')
  })

  it('the Screen 2 wrapper (post-Continue) also carries designEnterSlow', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    const el = document.querySelector('[data-transition]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-transition')).toBe('designEnterSlow')
  })
})

// =============================================================================
// Skip exits from anywhere, routing directly to home
// =============================================================================

describe('Skip routes to home from any screen', () => {
  it('Skip on Screen 1 calls router.push("/") exactly once', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('Skip on Screen 2 calls router.push("/")', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 2
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('Skip on Screen 3 calls router.push("/")', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 2
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 3
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('onboarding is single-pass: Skip from Screen 1 never renders Screen 2/3 copy', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(screen.queryByText(/meet others doing the same/i)).toBeNull()
    expect(screen.queryByText(/Sustained practice unlocks more/i)).toBeNull()
  })
})

// =============================================================================
// Typography-only layout (no imagery / icons at MVP)
// =============================================================================

describe('no imagery, zero illustrations', () => {
  it('renders no <img> elements on Screen 1', () => {
    render(React.createElement(OnboardingSequence))
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('renders no <img> elements after advancing through all 3 screens', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('renders no icon elements (data-icon / svg) anywhere in the sequence', () => {
    render(React.createElement(OnboardingSequence))
    expect(document.querySelectorAll('[data-icon]').length).toBe(0)
    expect(document.querySelectorAll('svg').length).toBe(0)
  })
})

// =============================================================================
// Screen-reader semantics + focus management
// =============================================================================

describe('section/h1 semantics and focus management', () => {
  it('Screen 1 wrapper renders as a <section>', () => {
    render(React.createElement(OnboardingSequence))
    expect(document.querySelector('section')).not.toBeNull()
  })

  it('the headline renders as an <h1>', () => {
    render(React.createElement(OnboardingSequence))
    expect(getHeadline().tagName.toLowerCase()).toBe('h1')
  })

  it('focus lands on the headline on first mount (screen 0)', async () => {
    render(React.createElement(OnboardingSequence))
    await flushRaf()
    expect(document.activeElement).toBe(getHeadline())
  })

  it('focus moves to the new headline after a Continue transition', async () => {
    render(React.createElement(OnboardingSequence))
    await flushRaf()
    const screen1Headline = getHeadline()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await flushRaf()
    const screen2Headline = getHeadline()
    expect(screen2Headline).not.toBe(screen1Headline)
    expect(document.activeElement).toBe(screen2Headline)
  })

  it('with initialScreen=2, Screen 3 renders directly and its headline receives focus', async () => {
    render(React.createElement(OnboardingSequence, { initialScreen: 2 }))
    await flushRaf()
    expect(screen.getByRole('button', { name: /get started/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull()
    expect(document.activeElement).toBe(getHeadline())
  })
})

// =============================================================================
// Reduced motion degrades the spring to the 100ms fallback
// =============================================================================

describe('reduced-motion degradation', () => {
  it('mounts with the 100ms transition (not designEnterSlow) when reduced motion is enabled', () => {
    mockReducedMotion.current = true
    render(React.createElement(OnboardingSequence))
    const el = document.querySelector('[data-transition]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-transition')).toBe('100ms')
  })

  it('keeps the 100ms transition across a Continue transition when reduced motion is enabled', () => {
    mockReducedMotion.current = true
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    const el = document.querySelector('[data-transition]')
    expect(el?.getAttribute('data-transition')).toBe('100ms')
  })

  it('uses designEnterSlow (not 100ms) when reduced motion is disabled', () => {
    mockReducedMotion.current = false
    render(React.createElement(OnboardingSequence))
    const el = document.querySelector('[data-transition]')
    expect(el?.getAttribute('data-transition')).toBe('designEnterSlow')
  })
})

// =============================================================================
// Transitions are re-entrancy-safe (idempotent double-tap guards)
// =============================================================================

describe('re-entrancy guard on Continue', () => {
  it('two synchronous Continue taps advance exactly ONE screen (not two)', () => {
    render(React.createElement(OnboardingSequence))
    const continueBtn = screen.getByRole('button', { name: /continue/i })

    act(() => {
      fireEvent.click(continueBtn)
      fireEvent.click(continueBtn)
    })

    // Should land on Screen 2 (Community), NOT Screen 3 (Progression).
    expect(screen.getByText(/meet others doing the same/i)).not.toBeNull()
    expect(screen.queryByText(/Sustained practice unlocks more/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull()
  })
})

describe('re-entrancy guard on exit navigation (Get started / Skip)', () => {
  it('two synchronous Get started taps call router.push and onDone("completed") exactly once each', () => {
    const onDone = vi.fn()
    render(React.createElement(OnboardingSequence, { onDone }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 2
    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 3

    const getStartedBtn = screen.getByRole('button', { name: /get started/i })
    act(() => {
      fireEvent.click(getStartedBtn)
      fireEvent.click(getStartedBtn)
    })

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith('completed')
  })

  it('two synchronous Skip taps call router.push and onDone("skipped") exactly once each', () => {
    const onDone = vi.fn()
    render(React.createElement(OnboardingSequence, { onDone }))
    const skipBtn = screen.getByRole('button', { name: /skip/i })

    act(() => {
      fireEvent.click(skipBtn)
      fireEvent.click(skipBtn)
    })

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith('skipped')
  })
})

// =============================================================================
// Forward-only navigation, single primary CTA, distinct onDone reasons
// =============================================================================

describe('no Back affordance anywhere in the sequence', () => {
  it('renders no Back/← labeled element on Screen 1, 2, or 3', () => {
    render(React.createElement(OnboardingSequence))
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.queryByText(/←/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 2
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.queryByText(/←/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /continue/i })) // → screen 3
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.queryByText(/←/)).toBeNull()
  })

  it('renders no Back/← labeled element when mounted directly on Screen 3 via initialScreen', () => {
    render(React.createElement(OnboardingSequence, { initialScreen: 2 }))
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.queryByText(/←/)).toBeNull()
  })
})

describe('exactly one primary CTA per screen', () => {
  it('Screen 1 exposes exactly one Continue button and no Get started', () => {
    render(React.createElement(OnboardingSequence))
    expect(screen.getAllByRole('button', { name: /^continue$/i }).length).toBe(1)
    expect(screen.queryByRole('button', { name: /get started/i })).toBeNull()
  })

  it('Screen 3 exposes exactly one Get started button and no Continue', () => {
    render(React.createElement(OnboardingSequence))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getAllByRole('button', { name: /get started/i }).length).toBe(1)
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull()
  })
})

describe('Screen 3 Skip vs Get started report distinct onDone reasons', () => {
  it('Get started reports onDone("completed") while routing home', () => {
    const onDone = vi.fn()
    render(React.createElement(OnboardingSequence, { onDone, initialScreen: 2 }))
    fireEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/')
    expect(onDone).toHaveBeenCalledWith('completed')
  })

  it('Skip on Screen 3 reports onDone("skipped") while routing home (distinct from Get started)', () => {
    const onDone = vi.fn()
    render(React.createElement(OnboardingSequence, { onDone, initialScreen: 2 }))
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(mockRouterPush).toHaveBeenCalledWith('/')
    expect(onDone).toHaveBeenCalledWith('skipped')
    expect(onDone).not.toHaveBeenCalledWith('completed')
  })
})

describe('onDone is optional; navigation still happens without throwing', () => {
  it('Get started with no onDone prop navigates without throwing', () => {
    render(React.createElement(OnboardingSequence, { initialScreen: 2 }))
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }))
    }).not.toThrow()
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })

  it('Skip with no onDone prop navigates without throwing', () => {
    render(React.createElement(OnboardingSequence))
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    }).not.toThrow()
    expect(mockRouterPush).toHaveBeenCalledWith('/')
  })
})
