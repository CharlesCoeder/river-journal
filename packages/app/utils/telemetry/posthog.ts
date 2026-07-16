/**
 * posthog.ts — web + desktop (Tauri renderer) product-analytics init + the ONE
 * sanctioned capture path.
 *
 * Both `apps/web` and `apps/desktop` consume THIS module via a thin
 * `instrumentation-client.ts` that calls `initPostHog()` right after
 * `initSentry()`. It mirrors the `sentry.ts` split exactly: the pure,
 * SDK-free validation lives in `eventAllowlist.ts` (importable everywhere and
 * unit-testable without loading the SDK); here we only wire the `posthog-js`
 * SDK, the EU host, the privacy-hardening options, and the runtime enforcement
 * nets. The native counterpart (`posthog.native.ts`) exposes the SAME surface
 * so call sites stay platform-agnostic.
 *
 * PRIVACY (NFR19 / NFR33): the allowlist + `captureEvent` is THE enforcement
 * point for the analytics surface, the way `beforeSend` is for crash
 * telemetry. Autocapture and session recording are OFF (they fire independently
 * of `captureEvent` and would ship journal/Collective content the allowlist
 * never inspects). Identity is the Supabase `user_id` ONLY — never PII.
 */

import posthog from 'posthog-js'
import { EVENT_ALLOWLIST, validateEventProps } from './eventAllowlist'
import { isContentKey, looksLikeFreeText } from './contentKeys'

/**
 * Whether PostHog should capture in the current environment.
 *
 * DEV QUIET (mirrors `sentryEnabled`): only enabled when a key is present AND
 * either this is a production build OR an explicit opt-in flag is set. In plain
 * local dev (flag unset) this is false, so the production key is never used and
 * no dev events pollute the production project.
 */
function posthogEnabled(): boolean {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return false
  return process.env.NEXT_PUBLIC_POSTHOG_ENABLED === 'true' || process.env.NODE_ENV === 'production'
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/**
 * Initialize PostHog for the browser/renderer. Safe to call once at client
 * entry; a no-op when disabled (dev without opt-in, or no key configured).
 */
export function initPostHog(): void {
  if (!posthogEnabled()) return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY as string
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.posthog.com'

  posthog.init(key, {
    api_host: apiHost,
    // Privacy hardening (same rationale as the Sentry replay/PII exclusion):
    // autocapture records DOM element text + inputs and session replay records
    // the screen verbatim — both would capture user content upstream of the
    // allowlist. Only explicit captureEvent() calls may emit.
    autocapture: false,
    disable_session_recording: true,
    // Don't create ghost profiles for anonymous pre-auth traffic.
    person_profiles: 'identified_only',
    // A URL path could carry an id; keep the surface minimal. Explicit events
    // are the only sanctioned emission.
    capture_pageview: false,
  })
}

/**
 * Set (or clear) the PostHog identity — Supabase `user_id` ONLY, never
 * email/display name/PII, and NO `$set` person properties. Pass `null` on
 * sign-out to call `reset()`.
 */
export function identifyPostHogUser(userId: string | null): void {
  if (userId) {
    posthog.identify(userId)
  } else {
    posthog.reset()
  }
}

/**
 * The ONLY sanctioned capture path. No code may call `posthog.capture(...)`
 * directly.
 *
 * Enforcement, in order:
 *  1. Un-enumerated event → no-op (dev-warn). Never sends an event the
 *     allowlist doesn't know about; never throws.
 *  2. Allowlist strip: keys not permitted for the event are removed
 *     (dev-warn), documented-but-missing keys are dev-warned.
 *  3. Runtime content-key net (independent of the allowlist — the "two nets"
 *     invariant): any `isContentKey()` match is dropped even if it somehow
 *     survived validation.
 *  4. Free-text VALUE net: an allowed key holding sentence-shaped prose
 *     (`looksLikeFreeText`) is dropped — closes the "allowed key, forbidden
 *     value" gap.
 * No super-properties / `$set` are ever registered.
 */
export function captureEvent(event: string, props?: Record<string, unknown>): void {
  const dev = isDev()
  const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event]

  // (1) Un-enumerated event: never send, warn in dev, never throw.
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

  // (2) Allowlist validation (unknown keys stripped, missing keys reported).
  const { sanitizedProps, strippedKeys, missingKeys } = validateEventProps(event, props)

  // (3)+(4) Runtime nets over the surviving props.
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

  if (!posthogEnabled()) return

  posthog.capture(event, finalProps)
}
