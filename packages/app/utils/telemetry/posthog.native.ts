/**
 * posthog.native.ts — mobile product-analytics init + the ONE sanctioned
 * capture path (React Native / Expo).
 *
 * Mirror of `posthog.ts` for `apps/mobile`, exposing the SAME
 * `initPostHog()` / `identifyPostHogUser()` / `captureEvent()` surface so call
 * sites stay platform-agnostic (`import { captureEvent } from
 * 'app/utils/telemetry/posthog'` resolves to THIS file on native, exactly like
 * `sentry.native.ts`). `posthog-react-native` is instance-based (not a global
 * singleton), so we hold a module-level `PostHog` instance.
 *
 * The pure validation + allowlist live in the SDK-free `eventAllowlist.ts`, so
 * this file only wires the native SDK, the EU host, the privacy-hardening
 * config (autocapture OFF, session replay never enabled), and the runtime
 * enforcement nets. `posthog-react-native` pulls native-only modules, so this
 * file MUST NOT be imported from shared (no-extension) code — it loads only on
 * the native platform (and, in tests, with the SDK mocked at the boundary).
 */

import { PostHog } from 'posthog-react-native'
import { EVENT_ALLOWLIST, validateEventProps } from './eventAllowlist'
import { isContentKey, looksLikeFreeText } from './contentKeys'

declare const __DEV__: boolean

/** Module-level instance — created on `initPostHog()`, null until then. */
let client: PostHog | null = null

/**
 * Whether PostHog should capture on device.
 *
 * DEV QUIET (mirrors `sentry.native.ts`): only enabled when a key is present
 * AND either this is a release build (`__DEV__` false) OR an explicit opt-in
 * flag is set. Under `__DEV__` without opt-in the production key is never used.
 */
function posthogEnabled(key: string | undefined): key is string {
  if (!key) return false
  const isRelease = typeof __DEV__ === 'undefined' || __DEV__ === false
  return isRelease || process.env.EXPO_PUBLIC_POSTHOG_ENABLED === 'true'
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true
}

/**
 * Initialize PostHog for the mobile app. Call once, early at the app entry.
 * A no-op when disabled (dev without opt-in, or no key configured).
 */
export function initPostHog(): void {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY
  if (!posthogEnabled(key)) return

  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.posthog.com'

  // Privacy hardening (same rationale as the Sentry mobile replay exclusion): a
  // bare instance (no PostHogProvider) does NOT autocapture touches/lifecycle,
  // and session replay is a separate opt-in plugin we never enable — so screen
  // content the allowlist never inspects can't leak. Only explicit
  // captureEvent() calls emit.
  client = new PostHog(key, { host })
}

/**
 * Set (or clear) the PostHog identity — Supabase `user_id` ONLY, never
 * email/display name/PII, and NO super-properties. Pass `null` on sign-out to
 * call `reset()`. A no-op (never throws) when no instance exists (disabled).
 */
export function identifyPostHogUser(userId: string | null): void {
  if (!client) return
  if (userId) {
    client.identify(userId)
  } else {
    client.reset()
  }
}

/**
 * The ONLY sanctioned capture path (native). Same enforcement order as the
 * web helper: un-enumerated event → no-op (dev-warn); allowlist strip; runtime
 * content-key net; free-text VALUE net. No super-properties are ever
 * registered. A no-op when disabled (no instance) — never throws.
 */
export function captureEvent(event: string, props?: Record<string, unknown>): void {
  const dev = isDev()
  const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event]

  if (!entry) {
    if (dev) {
      // eslint-disable-next-line no-console
      console.warn(
        `[posthog] captureEvent('${event}') was ignored — the event is not in the allowlist. ` +
          `Add it to packages/app/utils/telemetry/eventAllowlist.ts before use.`
      )
    }
    return
  }

  const { sanitizedProps, strippedKeys, missingKeys } = validateEventProps(event, props)

  const finalProps: Record<string, unknown> = {}
  const droppedContentKeys: string[] = []
  const droppedFreeTextKeys: string[] = []
  for (const [key, value] of Object.entries(sanitizedProps)) {
    if (isContentKey(key)) {
      droppedContentKeys.push(key)
      continue
    }
    if (typeof value === 'string' && looksLikeFreeText(value)) {
      droppedFreeTextKeys.push(key)
      continue
    }
    finalProps[key] = value
  }

  if (
    dev &&
    (strippedKeys.length > 0 ||
      missingKeys.length > 0 ||
      droppedContentKeys.length > 0 ||
      droppedFreeTextKeys.length > 0)
  ) {
    // eslint-disable-next-line no-console
    console.warn(`[posthog] captureEvent('${event}') sanitized payload`, {
      strippedKeys,
      missingKeys,
      droppedContentKeys,
      droppedFreeTextKeys,
    })
  }

  if (!client) return

  client.capture(event, finalProps as Parameters<PostHog['capture']>[1])
}
