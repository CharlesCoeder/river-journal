/**
 * Utils barrel export
 */

export { supabase } from './supabase'
export {
  initAuthListener,
  getInitialSession,
  signUpWithEmail,
  signInWithEmail,
  signOut,
  getAuthErrorMessage,
  AUTH_ERROR_MESSAGES,
} from './auth'
