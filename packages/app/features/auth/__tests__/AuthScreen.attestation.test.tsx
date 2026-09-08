// @vitest-environment happy-dom
/**
 * `AuthScreen` — 13+ attestation (sign-up only) + Collective-context copy.
 *
 * Covers the auth UX on the LIVE `AuthScreen` surface (`LoginForm`/`SignupForm`
 * are dead code with zero imports — this is the component every `/auth` route
 * actually renders):
 *   - the "I confirm I am 13 or older." checkbox renders ONLY on the sign-up
 *     tab, above the email/password form; the login tab has no checkbox and is
 *     gated on nothing (every existing account attested when it was created)
 *   - on sign-up, an unchecked box blocks BOTH the email submit and the Google
 *     button — but the Google button is never rendered disabled/greyed: the
 *     press is swallowed by its `canStart` gate and answered with the same
 *     inline nudge the email submit uses
 *   - a login never records an attestation and never queues the deferred
 *     `pendingAgeAttestation$` marker
 *   - a successful email/Google SIGN-UP records the one-time attestation
 *   - switching tabs resets the checkbox and clears the nudge
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

// ─── GoogleSignInButton — stub reproducing the real control's press contract:
// the `canStart` gate runs FIRST and a false return swallows the press entirely
// (no OAuth, no post-auth callbacks). `googleStartSpy` therefore stands in for
// "OAuth would have been initiated". The button's rendered `disabled` attribute
// is asserted separately — the whole point of `canStart` is that the control
// stays enabled-looking so a blocked tap can be explained.
const googleButtonPropsSpy = vi.fn()
const googleStartSpy = vi.fn()
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
          if (props.canStart && props.canStart() === false) return
          googleStartSpy()
          props.onAuthStart?.()
          // Native-only inline success path; the web variant never calls this.
          props.onSuccess?.()
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

// ─── Real observables — the same instances AuthScreen reads/writes ───────────
import { pendingAgeAttestation$, pendingCollectiveReturn$ } from 'app/state/authReturn'

// ─── Import under test ───────────────────────────────────────────────────────
import { AuthScreen } from '../AuthScreen'

const AGE_LABEL = /13 or older/i
const NUDGE = /confirm you.re 13 or older to continue/i

const goToSignupTab = () => {
  fireEvent.click(screen.getByText('Sign Up'))
}

const goToLoginTab = () => {
  // The tab label is the FIRST "Log In" in DOM order; the submit control (which
  // carries the same word in login mode) is the second.
  fireEvent.click(screen.getAllByText('Log In')[0] as HTMLElement)
}

const clickLoginSubmit = () => {
  fireEvent.click(screen.getAllByText('Log In')[1] as HTMLElement)
}

const fillLoginFields = () => {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'daniel@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
}

const fillSignupFields = () => {
  fillLoginFields()
  fireEvent.change(screen.getByLabelText('Confirm Password'), {
    target: { value: 'password123' },
  })
}

const checkAgeBox = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: AGE_LABEL }))
}

const googleButton = () => screen.getByTestId('google-signin-button') as HTMLButtonElement

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
  pendingAgeAttestation$.set(false)
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. The checkbox belongs to the sign-up tab only
// ─────────────────────────────────────────────────────────────────────────────
describe('13+ attestation checkbox placement', () => {
  it('renders NO checkbox on the login tab', () => {
    render(React.createElement(AuthScreen))
    expect(screen.queryByRole('checkbox', { name: AGE_LABEL })).toBeNull()
  })

  it('renders a checkbox labeled "I confirm I am 13 or older." on the sign-up tab', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    expect(screen.getByRole('checkbox', { name: AGE_LABEL })).toBeTruthy()
  })

  it('renders the checkbox ABOVE the email field in DOM order', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
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
    goToSignupTab()
    const checkbox = screen.getByRole('checkbox', { name: AGE_LABEL }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('renders the checkbox immediately when opened directly on the sign-up tab', () => {
    render(React.createElement(AuthScreen, { initialTab: 'signup' } as any))
    expect(screen.getByRole('checkbox', { name: AGE_LABEL })).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Login is gated on nothing — accounts attested when they were created
// ─────────────────────────────────────────────────────────────────────────────
describe('login mode is not gated on the 13+ attestation', () => {
  it('fires the email sign-in with no checkbox to check', () => {
    render(React.createElement(AuthScreen))
    fillLoginFields()
    clickLoginSubmit()
    expect(mockSignInWithEmail).toHaveBeenCalledWith('daniel@example.com', 'password123')
  })

  it('never surfaces the attestation nudge on the login tab', () => {
    render(React.createElement(AuthScreen))
    fillLoginFields()
    clickLoginSubmit()
    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('does NOT record an attestation after a successful email login', async () => {
    mockSignInWithEmail.mockResolvedValue({ user: { id: 'user-1' }, error: null })
    render(React.createElement(AuthScreen))
    fillLoginFields()
    clickLoginSubmit()
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/'))
    expect(mockRecordAgeAttestation).not.toHaveBeenCalled()
  })

  it('starts Google auth on the login tab with no attestation to give', () => {
    render(React.createElement(AuthScreen))
    fireEvent.click(googleButton())
    expect(googleStartSpy).toHaveBeenCalled()
  })

  it('does NOT queue the deferred attestation marker when starting Google auth from login', () => {
    render(React.createElement(AuthScreen))
    fireEvent.click(googleButton())
    expect(pendingAgeAttestation$.get()).toBe(false)
  })

  it('clears a stale deferred attestation marker when starting Google auth from login', () => {
    // Left behind by an abandoned earlier sign-up OAuth attempt: the marker is
    // written pre-redirect, before any session exists.
    pendingAgeAttestation$.set(true)
    render(React.createElement(AuthScreen))
    fireEvent.click(googleButton())
    expect(pendingAgeAttestation$.get()).toBe(false)
  })

  it('does NOT record an attestation on the native inline Google success path', () => {
    render(React.createElement(AuthScreen))
    fireEvent.click(googleButton())
    expect(mockRecordAgeAttestation).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sign-up gating while the 13+ box is unchecked
// ─────────────────────────────────────────────────────────────────────────────
describe('sign-up gating while the 13+ box is unchecked', () => {
  it('fires NO email auth call when submitting while unchecked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    fireEvent.click(screen.getByText('Create Account'))
    expect(mockSignUpWithEmail).not.toHaveBeenCalled()
    expect(mockSignInWithEmail).not.toHaveBeenCalled()
  })

  it('surfaces the inline nudge after a blocked submit attempt', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    fireEvent.click(screen.getByText('Create Account'))
    expect(screen.getByText(NUDGE)).toBeTruthy()
  })

  // The regression this replaces: the Google button used to render disabled and
  // greyed, so a user with an unchecked box tapped a dead control and was told
  // nothing.
  it('renders the Google button ENABLED (never greyed) while unchecked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    expect(googleButton().disabled).toBe(false)
    const lastProps = googleButtonPropsSpy.mock.calls.at(-1)?.[0]
    expect(lastProps?.disabled).toBeFalsy()
  })

  it('swallows the Google press while unchecked — no OAuth is initiated', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(googleStartSpy).not.toHaveBeenCalled()
    expect(mockSignInWithGoogle).not.toHaveBeenCalled()
  })

  it('answers a blocked Google press with the same inline nudge', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    expect(screen.queryByText(NUDGE)).toBeNull()
    fireEvent.click(googleButton())
    expect(screen.getByText(NUDGE)).toBeTruthy()
  })

  it('does NOT queue the deferred attestation marker on a blocked Google press', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(pendingAgeAttestation$.get()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Checking the box lets both controls through
// ─────────────────────────────────────────────────────────────────────────────
describe('checking the 13+ box lets both sign-up controls through', () => {
  it('starts Google auth once checked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    checkAgeBox()
    fireEvent.click(googleButton())
    expect(googleStartSpy).toHaveBeenCalled()
  })

  it('allows email submit to fire the auth call once checked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fillSignupFields()
    checkAgeBox()
    fireEvent.click(screen.getByText('Create Account'))
    expect(mockSignUpWithEmail).toHaveBeenCalledWith('daniel@example.com', 'password123')
  })

  it('clears the nudge as soon as the box is checked', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(screen.getByText(NUDGE)).toBeTruthy()
    checkAgeBox()
    expect(screen.queryByText(NUDGE)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Attestation recorded on successful account creation
// ─────────────────────────────────────────────────────────────────────────────
describe('records the one-time 13+ attestation after a successful sign-up', () => {
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
    mockSignUpWithEmail.mockResolvedValue({
      user: null,
      error: 'An account with this email already exists.',
    })
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

  it('queues the deferred attestation marker before Google OAuth on the sign-up tab', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    checkAgeBox()
    fireEvent.click(googleButton())
    expect(pendingAgeAttestation$.get()).toBe(true)
  })

  it('records the attestation on the native inline Google success path', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    checkAgeBox()
    fireEvent.click(googleButton())
    expect(mockRecordAgeAttestation).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Switching tabs resets the attestation state
// ─────────────────────────────────────────────────────────────────────────────
describe('switching tabs resets the attestation state', () => {
  it('drops a check made before leaving the sign-up tab', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    checkAgeBox()
    expect((screen.getByRole('checkbox', { name: AGE_LABEL }) as HTMLInputElement).checked).toBe(
      true
    )
    goToLoginTab()
    goToSignupTab()
    expect((screen.getByRole('checkbox', { name: AGE_LABEL }) as HTMLInputElement).checked).toBe(
      false
    )
  })

  it('clears a pending nudge when the tab changes', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(screen.getByText(NUDGE)).toBeTruthy()
    goToLoginTab()
    goToSignupTab()
    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('re-blocks a Google press after the check was reset by a tab switch', () => {
    render(React.createElement(AuthScreen))
    goToSignupTab()
    checkAgeBox()
    goToLoginTab()
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(googleStartSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Collective-context copy
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
// 8. Stale pendingCollectiveReturn$ marker self-heals on the next auth attempt
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

  it('resets a stale true marker to false after a successful email LOGIN with no collective context', async () => {
    pendingCollectiveReturn$.set(true)
    mockSignInWithEmail.mockResolvedValue({ user: { id: 'user-1' }, error: null })
    render(React.createElement(AuthScreen))
    fillLoginFields()
    clickLoginSubmit()
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
    fireEvent.click(googleButton())
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })

  it('sets the marker true when starting Google auth from the Collective gate', () => {
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    fireEvent.click(googleButton())
    expect(pendingCollectiveReturn$.get()).toBe(true)
  })

  it('leaves the marker untouched when the sign-up Google press is blocked', () => {
    render(React.createElement(AuthScreen, { gateContext: 'collective' } as any))
    goToSignupTab()
    fireEvent.click(googleButton())
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })
})
