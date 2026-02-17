import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase client
const mockSignInWithOAuth = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}))

vi.mock('../../state/store', () => ({
  store$: {
    session: {
      assign: vi.fn(),
    },
  },
}))

// Import after mocks
import { signInWithGoogle, getAuthErrorMessage, AUTH_ERROR_MESSAGES } from '../auth'

describe('Google OAuth - signInWithGoogle (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls supabase.auth.signInWithOAuth with google provider', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })

    const result = await signInWithGoogle()

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: undefined, // window not available in Node test env
      },
    })
    expect(result.error).toBeNull()
  })

  it('returns error message on failure', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      error: { message: 'OAuth error', code: 'access_denied' },
    })

    const result = await signInWithGoogle()

    expect(result.error).toBe('Sign in was cancelled. Please try again.')
  })
})

describe('Google OAuth - error messages', () => {
  it('maps access_denied to cancellation message', () => {
    expect(AUTH_ERROR_MESSAGES.access_denied).toBe('Sign in was cancelled. Please try again.')
  })

  it('maps invalid_token to failure message', () => {
    expect(AUTH_ERROR_MESSAGES.invalid_token).toBe('Authentication failed. Please try again.')
  })

  it('maps popup_closed to closed message', () => {
    expect(AUTH_ERROR_MESSAGES.popup_closed).toBe('Sign in window was closed. Please try again.')
  })

  it('getAuthErrorMessage handles known Google error codes', () => {
    const error = { message: 'some error', code: 'access_denied' } as any
    expect(getAuthErrorMessage(error)).toBe('Sign in was cancelled. Please try again.')
  })

  it('getAuthErrorMessage falls back to message for unknown codes', () => {
    const error = { message: 'Something unusual happened', code: 'unknown_code' } as any
    expect(getAuthErrorMessage(error)).toBe('Something unusual happened')
  })
})
