// @vitest-environment happy-dom
/**
 * AppLockOverlay.e2e.test.tsx — TDD red-phase E2E tests for the App Lock
 * overlay: the mobile biometric/credential gate and the web/desktop
 * passcode gate, exercising the full lock → attempt → success/failure
 * → retry workflow end-to-end.
 *
 * Red-phase contract: neither `AppLockOverlay.native.tsx` nor
 * `AppLockOverlay.web.tsx` (nor their shared dependency `state/appLock.ts`)
 * exist yet — this whole file fails at the top-level `import` with a
 * module-resolution error until they are created, per this repo's
 * established red-phase convention.
 *
 * Platform-split testing note: this repo's Vitest config does not replicate
 * Metro's `.native.tsx` / `.web.tsx` extension resolution (see
 * `vitest.config.mts` — `react-native` is aliased to `react-native-web`
 * globally, but arbitrary specifiers are NOT platform-resolved), so this
 * file imports each platform file by its concrete filename, matching how
 * production code elsewhere in this repo is exercised per-platform in tests.
 *
 * `react-native`'s `BackHandler` is a real no-op stub under `react-native-web`
 * (`console.error('BackHandler is not supported on web...')`), so the
 * Android-back-button test partially mocks `react-native` (via
 * `importOriginal`) to capture the registered `hardwareBackPress` handler —
 * everything else (`View`, `Animated`, `StyleSheet`) stays the real
 * `react-native-web` implementation.
 *
 * ASSUMED CONTRACT: export name `AppLockOverlay` from each platform file;
 * testID `app-lock-overlay` on the full-screen cover; "Try again" as the
 * literal retry button label (per the story's explicit copy); web passcode field
 * testID `app-lock-unlock-passcode-input`, submit testID
 * `app-lock-unlock-submit`.
 *
 * Coverage map:
 *   - mobile: locked → opaque full-screen overlay → failed/cancelled
 *          auth keeps the overlay with "Try again" → success dismisses it;
 *          the Android hardware back button is intercepted (no-op) while
 *          locked.
 *   - web/desktop: locked → passcode entry → wrong passcode keeps the
 *          overlay with "Try again" → correct passcode dismisses it.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ─── @my/ui mock — passthrough preserving onPress/testID ───────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const View = ({ children, testID }: any) =>
    ReactModule.createElement('div', { 'data-testid': testID }, children)
  const Text = ({ children }: any) => ReactModule.createElement('span', null, children)

  const ExpandingLineButton = ({ children, onPress, testID }: any) =>
    ReactModule.createElement(
      'button',
      { onClick: onPress, 'data-testid': testID ?? `btn-${String(children).toLowerCase()}` },
      children
    )

  const Input = ({ testID, value, onChangeText, secureTextEntry }: any) =>
    ReactModule.createElement('input', {
      'data-testid': testID,
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
      type: secureTextEntry ? 'password' : 'text',
    })

  return { View, Text, ExpandingLineButton, Input, useTheme: () => ({}) }
})

// ============================================================================
// Mobile overlay (biometric/credential gate)
// ============================================================================

describe('mobile lock overlay: cold start → auth attempt → success/failure/retry', () => {
  // Shared mock handles created via vi.hoisted so the file-top-hoisted vi.mock
  // factories below can reference them (a plain describe-scoped const is not in
  // scope of the hoisted factory).
  const h = vi.hoisted(() => ({
    backHandlerCallback: { current: null as (() => boolean) | null },
    backHandlerRemove: vi.fn(),
    promptAppLockAuthMock: vi.fn(),
  }))
  const backHandlerRemove = h.backHandlerRemove
  const promptAppLockAuthMock = h.promptAppLockAuthMock

  vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>()
    return {
      ...actual,
      Platform: { OS: 'ios' },
      BackHandler: {
        addEventListener: vi.fn((type: string, handler: () => boolean) => {
          if (type === 'hardwareBackPress') h.backHandlerCallback.current = handler
          return { remove: h.backHandlerRemove }
        }),
        removeEventListener: vi.fn(),
      },
    }
  })

  vi.mock('app/utils/appLockAuth', () => ({
    getAppLockCapability: () => Promise.resolve({ available: true, kind: 'biometric' as const }),
    promptAppLockAuth: () => h.promptAppLockAuthMock(),
  }))

  let AppLockOverlayNative: React.ComponentType
  let ephemeral$: typeof import('../../../state/store')['ephemeral$']

  beforeEach(async () => {
    h.backHandlerCallback.current = null
    backHandlerRemove.mockReset()
    promptAppLockAuthMock.mockReset()

    const overlayMod = await import('../AppLockOverlay.native')
    AppLockOverlayNative = overlayMod.AppLockOverlay
    const storeMod = await import('../../../state/store')
    ephemeral$ = storeMod.ephemeral$
    ephemeral$.isLocked.set(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a full-screen opaque cover synchronously when ephemeral$.isLocked is true on mount', () => {
    render(React.createElement(AppLockOverlayNative))
    expect(screen.getByTestId('app-lock-overlay')).toBeTruthy()
  })

  it('renders nothing when ephemeral$.isLocked is false', () => {
    ephemeral$.isLocked.set(false)
    render(React.createElement(AppLockOverlayNative))
    expect(screen.queryByTestId('app-lock-overlay')).toBeNull()
  })

  it('invokes the biometric/credential prompt on mount', async () => {
    promptAppLockAuthMock.mockResolvedValue(true)
    render(React.createElement(AppLockOverlayNative))
    await act(async () => {
      await Promise.resolve()
    })
    expect(promptAppLockAuthMock).toHaveBeenCalled()
  })

  it('successful auth dismisses the overlay and clears ephemeral$.isLocked', async () => {
    promptAppLockAuthMock.mockResolvedValue(true)
    render(React.createElement(AppLockOverlayNative))

    await act(async () => {
      await Promise.resolve()
    })

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('failed auth keeps the overlay with a "Try again" affordance — never silently unlocks', async () => {
    promptAppLockAuthMock.mockResolvedValue(false)
    render(React.createElement(AppLockOverlayNative))

    await act(async () => {
      await Promise.resolve()
    })

    expect(ephemeral$.isLocked.get()).toBe(true)
    expect(screen.getByText('Try again')).toBeTruthy()
    expect(screen.getByTestId('app-lock-overlay')).toBeTruthy()
  })

  it('tapping "Try again" re-invokes the prompt; a subsequent success then dismisses the overlay', async () => {
    promptAppLockAuthMock.mockResolvedValueOnce(false)
    render(React.createElement(AppLockOverlayNative))

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Try again')).toBeTruthy()

    promptAppLockAuthMock.mockResolvedValueOnce(true)
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'))
      await Promise.resolve()
    })

    expect(promptAppLockAuthMock).toHaveBeenCalledTimes(2)
    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('the Android hardware back button is intercepted while locked — it cannot dismiss the overlay', async () => {
    promptAppLockAuthMock.mockResolvedValue(false)
    render(React.createElement(AppLockOverlayNative))

    await act(async () => {
      await Promise.resolve()
    })

    expect(h.backHandlerCallback.current).not.toBeNull()
    // A hardwareBackPress handler returning true tells RN "I handled this,
    // do not navigate back" — the no-op contract this test locks in.
    const handled = h.backHandlerCallback.current?.()
    expect(handled).toBe(true)
    expect(ephemeral$.isLocked.get()).toBe(true)
    expect(screen.getByTestId('app-lock-overlay')).toBeTruthy()
  })
})

// ============================================================================
// Web/desktop overlay (passcode gate)
// ============================================================================

describe('web/desktop lock overlay: passcode entry → mismatch/retry/match', () => {
  vi.mock('../../../utils/encryption', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/encryption')>()
    const { createHash } = await import('node:crypto')
    return {
      ...actual,
      deriveMasterKeyFromPassword: async (password: string, saltB64: string) =>
        new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest()),
    }
  })

  let AppLockOverlayWeb: React.ComponentType
  let ephemeral$: typeof import('../../../state/store')['ephemeral$']
  let appLock$: typeof import('../../../state/appLock')['appLock$']
  let setPasscode: typeof import('../../../state/appLock')['setPasscode']

  beforeEach(async () => {
    const overlayMod = await import('../AppLockOverlay.web')
    AppLockOverlayWeb = overlayMod.AppLockOverlay
    const storeMod = await import('../../../state/store')
    ephemeral$ = storeMod.ephemeral$
    const appLockMod = await import('../../../state/appLock')
    appLock$ = appLockMod.appLock$
    setPasscode = appLockMod.setPasscode

    appLock$.set({
      enabled: true,
      autoLockInterval: 'immediately',
      passcodeSalt: null,
      passcodeVerifier: null,
    })
    await setPasscode('correctpass', {
      deriveMasterKeyFromPassword: async (password: string, saltB64: string) => {
        const { createHash } = await import('node:crypto')
        return new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest())
      },
    })
    ephemeral$.isLocked.set(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a passcode entry field while locked', () => {
    render(React.createElement(AppLockOverlayWeb))
    expect(screen.getByTestId('app-lock-unlock-passcode-input')).toBeTruthy()
  })

  it('a wrong passcode keeps the overlay with a "Try again" affordance', async () => {
    render(React.createElement(AppLockOverlayWeb))

    fireEvent.change(screen.getByTestId('app-lock-unlock-passcode-input'), {
      target: { value: 'wrongpass' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-lock-unlock-submit'))
    })

    expect(ephemeral$.isLocked.get()).toBe(true)
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  it('the correct passcode dismisses the overlay and clears ephemeral$.isLocked', async () => {
    render(React.createElement(AppLockOverlayWeb))

    fireEvent.change(screen.getByTestId('app-lock-unlock-passcode-input'), {
      target: { value: 'correctpass' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-lock-unlock-submit'))
    })

    expect(ephemeral$.isLocked.get()).toBe(false)
  })

  it('retrying after a mismatch with the correct passcode succeeds', async () => {
    render(React.createElement(AppLockOverlayWeb))

    fireEvent.change(screen.getByTestId('app-lock-unlock-passcode-input'), {
      target: { value: 'wrongpass' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-lock-unlock-submit'))
    })
    expect(ephemeral$.isLocked.get()).toBe(true)

    fireEvent.change(screen.getByTestId('app-lock-unlock-passcode-input'), {
      target: { value: 'correctpass' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-lock-unlock-submit'))
    })
    expect(ephemeral$.isLocked.get()).toBe(false)
  })
})
