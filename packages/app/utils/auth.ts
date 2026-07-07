/**
 * Auth utilities for Supabase authentication
 * Provides auth state sync with Legend-State store
 */

import type { Session, AuthError, User } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import { supabase } from './supabase'
import { store$ } from '../state/store'
import { batch } from '@legendapp/state'
import { deviceState$ } from '../state/syncConfig'
import { loadCurrentEncryptionMode, resetEncryptionSetupState } from '../state/encryptionSetup'
import { hasWebTrustCapability, getStoredDeviceToken, hashDeviceToken, clearWebTrustData } from './webKeyStore'
import { deleteTrustedBrowserByHash } from './userEncryption'
import { clearStoredMasterKey } from './encryptionKeyStore'
import { queryClient, QUERY_PERSIST_KEY } from '../state/queryClient'
import { queryStorage } from '../state/queryStorage'
import { resetSyncCursors } from '../state/persistConfig'

/**
 * Common Supabase auth error codes mapped to user-friendly messages
 */
export const AUTH_ERROR_MESSAGES = {
  user_already_exists: 'An account with this email already exists.',
  weak_password: 'Password must be at least 8 characters.',
  invalid_email: 'Please enter a valid email address.',
  signup_disabled: 'Sign up is currently disabled.',
  invalid_credentials: 'Invalid email or password.',
  email_not_confirmed: 'Please verify your email address.',
  // Google OAuth specific
  access_denied: 'Sign in was cancelled. Please try again.',
  invalid_token: 'Authentication failed. Please try again.',
  popup_closed: 'Sign in window was closed. Please try again.',
  // Identity linking specific
  identity_already_exists: 'This Google account is already linked to another account.',
  identity_not_found: 'Identity not found.',
  single_identity_not_deletable: 'You must keep at least one sign-in method.',
} satisfies Record<string, string>

/**
 * Gets a user-friendly error message from a Supabase AuthError
 */
export const getAuthErrorMessage = (error: AuthError): string => {
  // Check for known error codes
  const code = error.code || ''
  if (AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code]
  }

  // Check message for known patterns
  const message = error.message.toLowerCase()
  if (message.includes('already registered') || message.includes('already exists')) {
    return AUTH_ERROR_MESSAGES.user_already_exists
  }
  if (message.includes('password') && (message.includes('weak') || message.includes('short'))) {
    return AUTH_ERROR_MESSAGES.weak_password
  }
  if (message.includes('invalid') && message.includes('email')) {
    return AUTH_ERROR_MESSAGES.invalid_email
  }
  if (message.includes('identity') && message.includes('already')) {
    return AUTH_ERROR_MESSAGES.identity_already_exists
  }
  if (message.includes('single_identity') || message.includes('cannot delete')) {
    return AUTH_ERROR_MESSAGES.single_identity_not_deletable
  }

  // Fallback to the original message
  return error.message
}

/**
 * Updates Legend-State store with auth session data
 */
const updateSessionState = (session: Session | null) => {
  // NOTE: auto-wipe on user-change was removed. Wiping is now user-driven via
  // the previous-account banner in Settings. See spec
  // `docs/_bmad-output/implementation-artifacts/spec-fix-cross-user-data-defense.md`.

  batch(() => {
    if (session?.user) {
      store$.session.assign({
        userId: session.user.id,
        email: session.user.email ?? null,
        isAuthenticated: true,
      })
    } else {
      store$.session.assign({
        userId: null,
        email: null,
        isAuthenticated: false,
      })
    }
  })

  if (session?.user) {
    // Maintain device-state.lastAuthedUserId with WRITE-ONCE-PER-TRANSITION
    // semantics. The previous-account banner derives from
    // `lastAuthedUserId !== currentUserId`, so we MUST NOT overwrite the
    // value on every authenticated session — only on first-ever sign-in
    // (seed) or when the user resolves the banner (handled by the banner UI).
    const lastAuthedUserId = deviceState$.lastAuthedUserId.peek()
    if (lastAuthedUserId === null) {
      // Seed on first-ever sign-in. No banner is shown for this case.
      deviceState$.lastAuthedUserId.set(session.user.id)
    } else if (lastAuthedUserId === session.user.id) {
      // Same-user re-sign-in: no-op (no banner trigger, no overwrite needed).
    } else {
      // Different-user sign-in: leave lastAuthedUserId AS-IS (it points at
      // the previous account). previousAccountBanner$ will compare the two
      // and surface the banner. Banner actions ("Delete from this device" /
      // "Keep local") are responsible for advancing lastAuthedUserId.
    }

    void loadCurrentEncryptionMode()
  } else {
    // Do NOT clear lastAuthedUserId on SIGNED_OUT — the banner needs it to
    // survive the sign-out/sign-in transition.
    resetEncryptionSetupState()
  }
}

/**
 * Device-local privacy cleanup that MUST run on every real sign-out
 * (user-initiated `signOut()` AND the SIGNED_OUT auth event — never on
 * TOKEN_REFRESHED). Idempotent, best-effort per step: a failure in one step
 * never skips the others, and nothing here can block sign-out.
 *
 * Clears (device-local only):
 *  1. The E2E master key — in-memory cache + OS keychain / SecureStore /
 *     web-trust copy for the signed-out user. Server-side salts, managed
 *     keys, and key verifiers are NEVER touched (see userEncryption.ts —
 *     they must survive so the user can unlock again on next sign-in).
 *  2. The TanStack Query cache — in-memory AND the persisted 'rj-tq-cache'
 *     copy, so the next user of the device cannot hydrate the previous
 *     user's collective posts / "your posts" rows.
 *  3. Legend-State sync cursors ('last-sync' metadata for flows / entries /
 *     grace-days) so the next login performs a FULL pull. Without this, a
 *     different account's older rows are silently never fetched (missing
 *     history, broken streaks). Persisted row DATA is intentionally kept —
 *     the previous-account banner needs it to offer "Delete from this
 *     device" / "Keep local".
 *
 * Intentionally NOT cleared: Legend-State journal data (flows/entries/
 * grace-days — consent-gated via the previous-account banner), device-state
 * (lastAuthedUserId — the banner's trigger), and the Supabase session itself
 * (owned by supabase.auth.signOut()).
 */
export const performSignOutCleanup = async (userId: string | null): Promise<void> => {
  // 1. E2E master key: memory + platform keychain (+ web trust data on web).
  if (userId) {
    try {
      await clearStoredMasterKey(userId)
    } catch {
      // Best-effort — keychain I/O failure must not abort the rest.
    }
  }

  // 2. TanStack Query: in-memory cache first (stops components serving stale
  // rows immediately), then the persisted copy.
  try {
    queryClient.clear()
  } catch {
    // Best-effort
  }
  try {
    await queryStorage.removeItem(QUERY_PERSIST_KEY)
  } catch {
    // Best-effort — queryStorage already swallows internally; belt-and-braces.
  }

  // 3. Persisted sync cursors (changesSince metadata).
  try {
    await resetSyncCursors()
  } catch {
    // Best-effort
  }
}

/**
 * Initializes auth state listener
 * Call this once on app startup to sync Supabase auth with Legend-State
 */
export const initAuthListener = () => {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('🔐 Auth state change:', event)
    }

    if (event === 'TOKEN_REFRESHED') {
      // Token successfully refreshed — update session state with new tokens
      updateSessionState(session)
      return
    }

    if (event === 'SIGNED_OUT') {
      // Explicit sign-out or expired/revoked session — clear auth state
      // gracefully, then run the device-local privacy cleanup. Peek the
      // userId BEFORE updateSessionState(null) wipes it. This path also
      // covers sign-outs that never go through our signOut() wrapper
      // (session expiry, revocation, another tab). Cleanup is idempotent,
      // so double-running after a user-initiated signOut() is harmless.
      // TOKEN_REFRESHED is handled above and must NEVER reach this cleanup.
      const previousUserId = store$.session.userId.peek()
      updateSessionState(null)
      void performSignOutCleanup(previousUserId)
      return
    }

    updateSessionState(session)
  })

  return () => {
    subscription.unsubscribe()
  }
}

/**
 * Signs up a new user with email and password
 */
export const signUpWithEmail = async (
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    return { user: null, error: getAuthErrorMessage(error) }
  }

  return { user: data.user, error: null }
}

/**
 * Signs in a user with email and password
 */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { user: null, error: getAuthErrorMessage(error) }
  }

  return { user: data.user, error: null }
}

/**
 * Signs in with Google OAuth (web — redirect-based flow)
 * On web, this redirects the browser to Google's consent screen.
 * The existing `detectSessionInUrl: true` setting handles the return.
 */
export const signInWithGoogle = async (): Promise<{ error: string | null }> => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:
        Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })

  if (error) {
    return { error: getAuthErrorMessage(error) }
  }

  return { error: null }
}

/**
 * Signs out the current user
 */
export const signOut = async (): Promise<{ error: string | null }> => {
  // Capture the user id up front — supabase.auth.signOut() clears the session
  // and the SIGNED_OUT handler nulls store$.session.userId.
  const userId = store$.session.userId.peek()

  // Revoke web trust data before clearing session (best-effort, don't block
  // sign-out). Server-side revocation needs an authenticated client, so this
  // must happen BEFORE supabase.auth.signOut().
  if (hasWebTrustCapability()) {
    if (userId) {
      try {
        const localToken = await getStoredDeviceToken(userId).catch(() => null)
        if (localToken) {
          const hash = await hashDeviceToken(localToken).catch(() => null)
          if (hash) {
            await deleteTrustedBrowserByHash(userId, hash).catch(() => {})
          }
        }
        await clearWebTrustData(userId).catch(() => {})
      } catch {
        // Best-effort — sign-out must always complete
      }
    }
  }

  let errorMessage: string | null = null
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      errorMessage = error.message
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Sign out failed.'
  }

  // Device-local privacy cleanup — MUST run even when the Supabase call
  // failed or threw. Callers (SettingsScreen / MenuSurface / WordLinkNav /
  // PreviousAccountBanner) treat sign-out as done and navigate away, so a
  // skipped cleanup here would leave the previous user's master key, query
  // cache, and sync cursors behind for the next user of the device. The
  // SIGNED_OUT auth event runs it again on success — it is idempotent.
  await performSignOutCleanup(userId)

  return { error: errorMessage }
}

/**
 * Checks if the current user has a password set via the user_has_password() RPC.
 * Requires the SECURITY DEFINER function to be deployed in Supabase.
 */
export const checkHasPassword = async (): Promise<{
  hasPassword: boolean
  error: string | null
}> => {
  const { data, error } = await supabase.rpc('user_has_password')

  if (error) {
    return { hasPassword: false, error: error.message }
  }

  return { hasPassword: data === true, error: null }
}

/**
 * Gets the current user's linked identity providers.
 */
export const getUserProviders = async () => {
  const { data, error } = await supabase.auth.getUserIdentities()

  if (error) {
    return { identities: [], error: getAuthErrorMessage(error) }
  }

  return { identities: data.identities, error: null }
}

/**
 * Updates (or sets) the current user's password.
 * Works for both "add password" (OAuth-only user) and "change password" flows.
 */
export const updatePassword = async (newPassword: string): Promise<{ error: string | null }> => {
  const { error } = await supabase.auth.updateUser({ password: newPassword })

  if (error) {
    return { error: getAuthErrorMessage(error) }
  }

  return { error: null }
}
