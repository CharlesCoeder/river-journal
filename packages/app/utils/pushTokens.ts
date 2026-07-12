/**
 * utils/pushTokens.ts — web/desktop no-op stub for the push-token registration
 * boundary.
 *
 * This is the platform-agnostic sibling of `utils/pushTokens.native.ts`. Metro
 * resolves `.native.ts` on iOS/Android; Next/Tamagui resolves this `.ts` on
 * web/desktop. Because push notifications ship only on mobile at launch (OS-level
 * web/desktop push is Growth-scoped), every export here is a benign no-op and
 * this file imports NONE of the native notification/device SDKs — guaranteeing
 * that SDK is never bundled on web/desktop (the boundary grep in "No
 * regressions").
 */

/** Outcome of a push-token registration attempt. */
export type PushRegistrationOutcome =
  | { outcome: 'granted' } // token issued/reused and upserted
  | { outcome: 'granted-no-token' } // OS grant succeeded but token issuance failed
  | { outcome: 'denied' } // OS permission not granted
  | { outcome: 'unsupported' } // non-native platform (this stub)

/** No-op on web/desktop — there is no OS push permission to request. */
export async function requestAndRegisterPushToken(): Promise<PushRegistrationOutcome> {
  return { outcome: 'unsupported' }
}

/** No-op on web/desktop — no native tokens are ever registered here. */
export function hasLivePushToken(_userId: string): boolean {
  return false
}

/**
 * No-op on web/desktop — reports a non-'granted' status so a caller composing
 * the gate's silent-register branch never mistakes web for an already-granted
 * OS state.
 */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  return 'undetermined'
}
