/**
 * authSentryWiring.e2e.test.ts — TDD RED-PHASE E2E spec for  * ("PII stripping on user context") of this story.
 *
 * "When Sentry captures user context, it uses the Supabase user_id
 * only — never email, display name, or any other PII." The Dev Notes
 * point this wiring at the existing `initAuthListener` in
 * `packages/app/utils/auth.ts`: "Wire it to auth state changes ... clear
 * the user on sign-out."
 *
 * This is the full end-to-end workflow for that AC on a headless module:
 * a real Supabase auth-state-change event fires → the REAL `initAuthListener`
 * (unmodified production code, not re-implemented here) runs → it must call
 * the telemetry layer's `setSentryUser` with ONLY the user id, and clear it
 * on sign-out.
 *
 * Mocking scaffold intentionally mirrors `auth-signout.test.ts` (the
 * existing, passing spec for this same `initAuthListener` function) so this
 * file exercises the SAME real `../auth` module end-to-end, adding only the
 * new `../telemetry/sentry` boundary this story introduces. All the other
 * mocks below (`../supabase`, `../../state/store`, etc.) are copied from
 * that sibling spec's proven-working scaffold, not reinvented.
 *
 * RED PHASE: `packages/app/utils/telemetry/sentry.ts` does not exist yet,
 * AND `../auth` does not yet call `setSentryUser` at all. Every assertion
 * below MUST fail until this story wires the two together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (before importing ../auth) ────────────────────────────────────────

type AuthChangeCallback = (event: string, session: unknown) => void
let authChangeCallback: AuthChangeCallback | null = null

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        authChangeCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}))

let currentUserId: string | null = 'user-1'
vi.mock('../../state/store', () => ({
  store$: {
    session: {
      assign: vi.fn(),
      userId: {
        peek: () => currentUserId,
      },
    },
  },
}))

vi.mock('../../state/syncConfig', () => ({
  deviceState$: {
    lastAuthedUserId: {
      peek: vi.fn(() => null),
      set: vi.fn(),
    },
  },
}))

vi.mock('../../state/encryptionSetup', () => ({
  loadCurrentEncryptionMode: vi.fn(() => Promise.resolve(null)),
  resetEncryptionSetupState: vi.fn(),
  encryptionSetup$: {
    hasLoadedMode: {
      peek: () => false,
    },
  },
}))

vi.mock('../webKeyStore', () => ({
  hasWebTrustCapability: vi.fn(() => false),
  getStoredDeviceToken: vi.fn(() => Promise.resolve(null)),
  hashDeviceToken: vi.fn(() => Promise.resolve(null)),
  clearWebTrustData: vi.fn(() => Promise.resolve()),
}))

vi.mock('../userEncryption', () => ({
  deleteTrustedBrowserByHash: vi.fn(() => Promise.resolve({ error: null })),
}))

vi.mock('../encryptionKeyStore', () => ({
  clearStoredMasterKey: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../state/queryClient', () => ({
  queryClient: {
    clear: vi.fn(),
  },
  QUERY_PERSIST_KEY: 'rj-tq-cache',
}))

vi.mock('../../state/queryStorage', () => ({
  queryStorage: {
    removeItem: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('../../state/persistConfig', () => ({
  resetSyncCursors: vi.fn(() => Promise.resolve()),
  persistPlugin: {},
  configurePersistence: vi.fn(),
}))

// The new telemetry boundary this story introduces ().
const mockSetSentryUser = vi.fn()
vi.mock('../telemetry/sentry', () => ({
  setSentryUser: (...args: unknown[]) => mockSetSentryUser(...args),
  initSentry: vi.fn(),
}))

// Import the REAL, unmodified auth.ts after all mocks are registered.
import { initAuthListener } from '../auth'

beforeEach(() => {
  vi.clearAllMocks()
  currentUserId = 'user-1'
  authChangeCallback = null
})

describe('initAuthListener — Sentry user context is Supabase user_id ONLY', () => {
  it('on SIGNED_IN, forwards ONLY the Supabase user id to setSentryUser (never email/name)', async () => {
    initAuthListener()
    expect(authChangeCallback).toBeTypeOf('function')

    authChangeCallback!('SIGNED_IN', {
      user: {
        id: 'user-2',
        email: 'private-email@example.com',
        user_metadata: { full_name: 'Jane Doe' },
      },
    })

    await vi.waitFor(() => {
      expect(mockSetSentryUser).toHaveBeenCalled()
    })

    // Every call must carry only the id — as a bare string arg, or as an
    // object whose only key is `id`. Either shape must never leak email/name.
    for (const call of mockSetSentryUser.mock.calls) {
      const arg = call[0]
      if (arg && typeof arg === 'object') {
        expect(arg).toEqual({ id: 'user-2' })
      } else {
        expect(arg).toBe('user-2')
      }
    }
  })

  it('on SIGNED_OUT, clears the Sentry user context', async () => {
    initAuthListener()

    authChangeCallback!('SIGNED_OUT', null)

    await vi.waitFor(() => {
      expect(mockSetSentryUser).toHaveBeenCalled()
    })

    const lastCall = mockSetSentryUser.mock.calls.at(-1)
    const arg = lastCall?.[0]
    expect(arg === null || arg === undefined).toBe(true)
  })

  it('never passes the full session/user object (which contains email) to setSentryUser', async () => {
    initAuthListener()

    const session = {
      user: { id: 'user-3', email: 'someone@example.com' },
    }
    authChangeCallback!('SIGNED_IN', session)

    await vi.waitFor(() => {
      expect(mockSetSentryUser).toHaveBeenCalled()
    })

    for (const call of mockSetSentryUser.mock.calls) {
      expect(call[0]).not.toBe(session)
      expect(call[0]).not.toBe(session.user)
      expect(JSON.stringify(call[0] ?? '')).not.toContain('someone@example.com')
    }
  })
})
