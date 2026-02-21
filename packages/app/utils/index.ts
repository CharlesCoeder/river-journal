/**
 * Utils barrel export
 */

export { supabase } from './supabase'
export {
  initAuthListener,
  getInitialSession,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  getAuthErrorMessage,
  AUTH_ERROR_MESSAGES,
  checkHasPassword,
  getUserProviders,
  updatePassword,
} from './auth'
