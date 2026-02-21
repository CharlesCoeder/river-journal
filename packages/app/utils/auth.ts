/**
 * Auth utilities for Supabase authentication
 * Provides auth state sync with Legend-State store
 */

import type { Session, AuthError, User } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import { supabase } from './supabase'
import { store$ } from '../state/store'
import { batch } from '@legendapp/state'

/**
 * Common Supabase auth error codes mapped to user-friendly messages
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
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
}

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
      console.log('🔐 Auth state change:', event, session?.user?.email)
    }

    if (event === 'TOKEN_REFRESHED') {
      // Token successfully refreshed — update session state with new tokens
      updateSessionState(session)
      return
    }

    if (event === 'SIGNED_OUT') {
      // Explicit sign-out or expired/revoked session — clear auth state gracefully
      updateSessionState(null)
      return
    }

    updateSessionState(session)
  })

  return () => {
    subscription.unsubscribe()
  }
}

/**
 * Gets the current auth session (for initial hydration)
 */
export const getInitialSession = async (): Promise<Session | null> => {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    console.error('Error getting initial session:', error)
    return null
  }
  return data.session
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
  const { error } = await supabase.auth.signOut()

  if (error) {
    return { error: error.message }
  }

  return { error: null }
}

/**
 * Checks if the current user has a password set via the user_has_password() RPC.
 * Requires the SECURITY DEFINER function to be deployed in Supabase.
 */
export const checkHasPassword = async (): Promise<{ hasPassword: boolean; error: string | null }> => {
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
export const updatePassword = async (
  newPassword: string
): Promise<{ error: string | null }> => {
  const { error } = await supabase.auth.updateUser({ password: newPassword })

  if (error) {
    return { error: getAuthErrorMessage(error) }
  }

  return { error: null }
}
