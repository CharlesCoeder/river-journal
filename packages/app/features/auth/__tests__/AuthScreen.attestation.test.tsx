// @vitest-environment happy-dom
/**
 * `AuthScreen` — 13+ attestation gating + Collective-context copy.
 *
 * Covers the NET-NEW auth UX added on top of the LIVE `AuthScreen` surface
 * (`LoginForm`/`SignupForm` are dead code with zero imports — this is the
 * component every `/auth` route actually renders):
 *   - a required "I confirm I am 13 or older." checkbox renders ABOVE the
 *     email/password form
 *   - BOTH the email submit control AND the Google button stay disabled
 *     (no auth call fires) until the checkbox is checked
 *   - checking the box enables both controls
 *   - a successful email signup records the one-time attestation via
 *     `recordAgeAttestation`
 *   - a `gateContext="collective"` prop swaps the subtitle to the
 *     Collective-context copy; the default (no prop) subtitle is unchanged
 *
 * Mock strategy mirrors `features/home/__tests__/HomeScreen.test.tsx`
 * (`@my/ui` mapped to plain DOM elements with testID/accessibilityRole/
 * accessibilityLabel/onPress forwarded) and `utils/__tests__/auth-google.test.ts`
 * (`app/utils` auth calls stubbed as spies). `DesignInput` and
 * `GoogleSignInButton` are mocked directly so this file stays scoped to
 * `AuthScreen`'s own gating/copy logic — the real controls have (or will
 * have) their own coverage. `useObservable`/`use$` from `@legendapp/state/react`
 * are NOT mocked — `AuthScreen`'s form state is purely local/ephemeral, so the
 * real hooks are safe to run in this environment.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ─── @my/ui mock — map Tamagui primitives to testable HTML elements ─────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, children, accessibilityRole, accessibilityLabel, ...rest } = props
    return {
      ...rest,
      ...(testID ? { 'data-testid': testID } : {}),
      ...(accessibilityRole ? { role: accessibilityRole } : {}),
      ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      ...(onPress ? { onClick: onPress } : {}),
    }
  }

  const passthrough = (tagName: keyof HTMLElementTagNameMap) => {
    const Component = ({ children, ...props }: any) =>
      ReactModule.createElement(tagName, mapProps(props), children)
    Component.displayName = tagName
    return Component
  }

  const AnimatePresence = ({ children }: any) =>
    ReactModule.createElement(ReactModule.Fragment, null, children)

  const Spinner = () => ReactModule.createElement('span', { 'data-testid': 'spinner' })

  // Defensive stub in case the checkbox is built from the Tamagui `Checkbox`
  // primitive (`checked` / `onCheckedChange`). If the implementation instead
  // builds a custom control from XStack/View + `onPress`, this export is
  // simply unused — the passthrough mocks above still surface
  // accessibilityRole/accessibilityLabel/onPress for that case.
  const Checkbox = ({ checked, onCheckedChange, testID, accessibilityLabel, ...props }: any) =>
    ReactModule.createElement('input', {
      type: 'checkbox',
      role: 'checkbox',
      ...(testID ? { 'data-testid': testID } : {}),
      ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
      checked: !!checked,
      onChange: (e: any) => onCheckedChange?.(e.target.checked),
      ...props,
    })

  return {
    AnimatePresence,
    ScrollView: passthrough('div'),
    YStack: passthrough('div'),
    XStack: passthrough('div'),
    View: passthrough('div'),
    Text: passthrough('span'),
    Spinner,
    Checkbox,
  }
})

// ─── solito/navigation — local push spy ──────────────────────────────────────
const pushSpy = vi.fn()
vi.mock('solito/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/auth',
  useLink: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => ({}),
}))

// ─── app/utils — auth call spies ─────────────────────────────────────────────
const mockSignInWithEmail = vi.fn()
const mockSignUpWithEmail = vi.fn()
const mockSignInWithGoogle = vi.fn()
const mockRecordAgeAttestation = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('app/utils', () => ({
  signInWithEmail: (...args: unknown[]) => mockSignInWithEmail(...args),
  signUpWithEmail: (...args: unknown[]) => mockSignUpWithEmail(...args),
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
  recordAgeAttestation: (...args: unknown[]) => mockRecordAgeAttestation(...args),
}))

// ─── DesignInput — controlled stub input, aria-label = placeholder ─────────
vi.mock('../components/DesignInput', () => ({
  DesignInput: ({ value, onChangeText, placeholder, disabled }: any) =>
    React.createElement('input', {
      'aria-label': placeholder,
      value,
      disabled: !!disabled,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
}))

// ─── GoogleSignInButton — stub exposing the `disabled` prop as a real DOM
// disabled button so the gating behavior can be asserted without depending on the real
// component's OAuth wiring (covered separately).
const googleButtonPropsSpy = vi.fn()
vi.mock('../components/GoogleSignInButton', () => ({
  GoogleSignInButton: (props: any) => {
    googleButtonPropsSpy(props)
    return React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'google-signin-button',
        disabled: !!props.disabled,
        onClick: () => {
          if (!props.disabled) {
            props.onAuthStart?.()
            props.onSuccess?.()
          }
        },
      },
      'Continue with Google'
    )
  },
}))

// ─── WordLinkNav ─────────────────────────────────────────────────────────────
vi.mock('app/features/navigation/WordLinkNav', () => ({
  WordLinkNav: () => React.createElement('nav', { 'data-testid': 'word-link-nav' }),
}))

// ─── Real observable — same instance AuthScreen reads/writes, used to assert
// the stale pendingCollectiveReturn$ marker self-heals on the next auth
// attempt instead of only ever being set true. ─────────────────────────────
import { pendingCollectiveReturn$ } from 'app/state/authReturn'

// ─── Import under test ───────────────────────────────────────────────────────
import { AuthScreen } from '../AuthScreen'

const AGE_LABEL = /13 or older/i

const goToSignupTab = () => {
  fireEvent.click(screen.getByText('Sign Up'))
}

const fillSignupFields = () => {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'daniel@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
  fireEvent.change(screen.getByLabelText('Confirm Password'), {
    target: { value: 'password123' },
  })
}

const checkAgeBox = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: AGE_LABEL }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordAgeAttestation.mockResolvedValue(undefined)
  // Sensible defaults so a call that isn't the focus of a given test (e.g.
  // clicking submit once checked, in tests that only assert on the Google
  // button or the checkbox) doesn't produce an unhandled-rejection from
  // AuthScreen destructuring `{ user, error }` off an undefined resolution.
  mockSignUpWithEmail.mockResolvedValue({ user: null, error: null })
  mockSignInWithEmail.mockResolvedValue({ user: null, error: null })
  pendingCollectiveReturn$.set(false)
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Checkbox renders above the form
// ─────────────────────────────────────────────────────────────────────────────
describe('13+ attestation checkbox placement', () => {
  it('renders a checkbox labeled "I confirm I am 13 or older."', () => {
    render(React.createElement(AuthScreen))
    expect(screen.getByRole('checkbox', { name: AGE_LABEL })).toBeTruthy()
  })

  it('renders the checkbox ABOVE the email field in DOM order', () => {
    render(React.createElement(AuthScreen))
    const checkbox = screen.getByRole('checkbox', { name: AGE_LABEL })
    const emailInput = screen.getByLabelText('Email address')
    const allInputs = Array.from(document.body.querySelectorAll('input'))
    const checkboxIdx = allInputs.indexOf(checkbox as HTMLInputElement)
    const emailIdx = allInputs.indexOf(emailInput as HTMLInputElement)
    expect(checkboxIdx).toBeGreaterThanOrEqual(0)
    expect(checkboxIdx).toBeLessThan(emailIdx)
  })

  it('checkbox starts unchecked', () => {
    render(React.createElement(AuthScreen))
    const checkbox = screen.getByRole('checkbox', { name: AGE_LABEL }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Submit + Google gating while unchecked
// ─────────────────────────────────────────────────────────────────────────────
describe('submit gating while the 13+ box is unchecked', () => {
  it('fires NO email auth call when submitting while unchecked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    fireEvent.click(screen.getByText('Create Account'))
    expect(mockSignUpWithEmail).not.toHaveBeenCalled()
    expect(mockSignInWithEmail).not.toHaveBeenCalled()
  })

  it('surfaces inline microcopy after a blocked submit attempt', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    fireEvent.click(screen.getByText('Create Account'))
    // Two matches expected once blocked: the checkbox's own label plus the
    // inline requirement microcopy near it.
    expect(screen.queryAllByText(AGE_LABEL).length).toBeGreaterThan(1)
  })

  it('renders the Google button as disabled while unchecked', () => {
    render(React.createElement(AuthScreen))
    expect((screen.getByTestId('google-signin-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('fires no Google OAuth call when the disabled Google button is pressed', () => {
    render(React.createElement(AuthScreen))
    fireEvent.click(screen.getByTestId('google-signin-button'))
    expect(mockSignInWithGoogle).not.toHaveBeenCalled()
    const lastProps = googleButtonPropsSpy.mock.calls.at(-1)?.[0]
    expect(lastProps?.disabled).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Checking the box enables both controls
// ─────────────────────────────────────────────────────────────────────────────
describe('checking the 13+ box enables both controls', () => {
  it('enables the Google button once checked', () => {
    render(React.createElement(AuthScreen))
    checkAgeBox()
    expect((screen.getByTestId('google-signin-button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('allows email submit to fire the auth call once checked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    expect(mockSignUpWithEmail).toHaveBeenCalledWith('daniel@example.com', 'password123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Attestation recorded on successful signup
// ─────────────────────────────────────────────────────────────────────────────
describe('records the one-time 13+ attestation after successful signup', () => {
  it('calls recordAgeAttestation with the new user id after a successful signup', async () => {
    mockSignUpWithEmail.mockResolvedValue({ user: { id: 'user-1' }, error: null })
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    await waitFor(() => expect(mockRecordAgeAttestation).toHaveBeenCalledWith('user-1'))
  })

  it('does NOT call recordAgeAttestation when signup returns an error', async () => {
    mockSignUpWithEmail.mockResolvedValue({ user: null, error: 'An account with this email already exists.' })
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockRecordAgeAttestation).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Collective-context copy
// ─────────────────────────────────────────────────────────────────────────────
describe('Collective-context copy', () => {
  it('shows the default "Accounts are optional" subtitle with no gateContext', () => {
    render(React.createElement(AuthScreen))
    expect(screen.getByText(/accounts are optional/i)).toBeTruthy()
  })

  it('shows "To join the Collective, you\'ll need an account." when gateContext="collective"', () => {
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    expect(screen.getByText(/to join the collective.*need an account/i)).toBeTruthy()
  })

  it('hides the default subtitle when gateContext="collective"', () => {
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    expect(screen.queryByText(/accounts are optional/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Stale pendingCollectiveReturn$ marker self-heals on the next auth attempt
//
// An abandoned Google-web OAuth from the Collective gate can leave
// pendingCollectiveReturn$ stuck true (it's set pre-redirect, before a
// session exists). A later, unrelated auth attempt (e.g. email login opened
// directly at /auth, with no collective context) must overwrite — not just
// conditionally set — the marker so it can't surprise-forward that unrelated
// sign-in to /collective via the home-forward effect.
// ─────────────────────────────────────────────────────────────────────────────
describe('stale pendingCollectiveReturn$ marker self-heals on the next auth attempt', () => {
  it('resets a stale true marker to false after a successful email auth with no collective context', async () => {
    pendingCollectiveReturn$.set(true) // simulates a marker left by an abandoned prior OAuth attempt
    mockSignUpWithEmail.mockResolvedValue({ user: { id: 'user-1' }, error: null })
    render(React.createElement(AuthScreen)) // no gateContext / returnTo
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    await waitFor(() => expect(pendingCollectiveReturn$.get()).toBe(false))
  })

  it('sets the marker true after a successful email auth initiated from the Collective gate', async () => {
    mockSignUpWithEmail.mockResolvedValue({ user: { id: 'user-1' }, error: null })
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    await waitFor(() => expect(pendingCollectiveReturn$.get()).toBe(true))
  })

  it('resets a stale true marker to false when starting Google auth with no collective context', () => {
    pendingCollectiveReturn$.set(true) // simulates a marker left by an abandoned prior OAuth attempt
    render(React.createElement(AuthScreen))
    checkAgeBox()
    fireEvent.click(screen.getByTestId('google-signin-button'))
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })

  it('sets the marker true when starting Google auth from the Collective gate', () => {
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    checkAgeBox()
    fireEvent.click(screen.getByTestId('google-signin-button'))
    expect(pendingCollectiveReturn$.get()).toBe(true)
  })
})
