/**
 * Auth utilities for Supabase authentication
 * Provides auth state sync with Legend-State store
 */

import type { Session, AuthError, User } from '@supabase/supabase-js'
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
  // Listen for auth state changes
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('🔐 Auth state change:', event, session?.user?.email)
    }

    updateSessionState(session)
  })

  // Return unsubscribe function for cleanup
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
 * Signs out the current user
 */
export const signOut = async (): Promise<{ error: string | null }> => {
  const { error } = await supabase.auth.signOut()

  if (error) {
    return { error: error.message }
  }

  return { error: null }
}
