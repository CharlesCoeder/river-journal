// posthog.ts — the server-side (Deno/Edge) product-analytics emit helper.
//
// The ONE sanctioned server capture path: `emitServerEvent`. It mirrors the
// client `captureEvent` (packages/app/utils/telemetry/posthog.ts) four-net
// enforcement, but POSTs a single event to PostHog's capture endpoint via a
// direct `fetch` (modeled on `_shared/expoPush.ts`) rather than the SDK.
//
// PRIVACY (NFR19): every emitted event is validated against the SERVER
// `EVENT_ALLOWLIST` mirror, then run through the SAME two runtime nets the
// logger and the client applies — the content-key net (`isContentKey`) and the
// free-text-value net (`looksLikeFreeText`), both from `_shared/contentKeys.ts`.
// No journal/post content, moderation free text, receipt payload, email, or
// display name can ride an emitted event. Identity is a caller-supplied
// distinct id only (a real user id ONLY where the allowlist permits it — see
// SERVER_DISTINCT_ID for the anonymized/aggregate events).
//
// FAIL-OPEN (non-negotiable): these functions perform money-moving and
// destructive primary work. A PostHog outage MUST NOT fail any of them.
// `emitServerEvent` swallows every error (network, non-2xx, timeout, missing
// config, malformed input) internally and resolves void — it NEVER throws and
// NEVER surfaces a value that could change a caller's control flow. A telemetry
// failure is logged metadata-only (event name + outcome ONLY — never the props
// payload) via `logError`, the exclusive server log path.
//
// ENV-GATED: emission requires `POSTHOG_API_KEY`. Unset (local dev, `deno test`,
// an unconfigured environment) is a silent no-op — no fetch, no failure. The
// operator sets `POSTHOG_API_KEY` (and optionally `POSTHOG_HOST`) in the
// Supabase Edge Function secrets for emission to occur in production.

import { EVENT_ALLOWLIST, validateEventProps } from './eventAllowlist.ts'
import { isContentKey, looksLikeFreeText } from './contentKeys.ts'
import { logError } from './logging.ts'

/**
 * The one documented non-user distinct id shared by every anonymized/aggregate
 * server event (`account_deleted`, `collective_reply_delivered`,
 * `moderation_notification_delivered`). PostHog requires a `distinct_id` on
 * every event; these events intentionally retain NO user id, so they use this
 * fixed constant rather than a real user id (which would re-associate an
 * anonymized event with a specific person and defeat the allowlist's omission
 * of `user_id`).
 */
export const SERVER_DISTINCT_ID = 'server'

// EU-region ingestion-only host (the `i.` subdomain PostHog recommends for
// server-side/capture-only traffic). NOT byte-identical to the client's host
// (`https://eu.posthog.com`) — the client needs the full app/API host for
// decide/flags traffic a server-only emitter never makes; the shared property
// is the EU region, not the literal string. Override via POSTHOG_HOST.
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

// A short timeout so a slow/hung PostHog can never add meaningful latency to
// the user-facing action the caller is completing.
const EMIT_TIMEOUT_MS = 3000

// Defensive env read: `deno test` may run without --allow-env, in which case
// Deno.env.get throws — treat that as "unset".
function readEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key)
  } catch {
    return undefined
  }
}

/**
 * The two REDUNDANT runtime nets (independent of the allowlist strip), applied
 * over already-validated props: drop any key `isContentKey()` matches, and drop
 * any string value `looksLikeFreeText()` matches. Every other entry passes
 * through unchanged. Pure — extracted so the nets are unit-testable in isolation
 * (the real allowlist never admits a content-shaped key, so the key net is
 * otherwise unreachable through the public two-arg path).
 */
export function applyContentSafetyNets(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (isContentKey(key)) {
      continue
    }
    if (typeof value === 'string' && looksLikeFreeText(value)) {
      continue
    }
    out[key] = value
  }
  return out
}

export interface EmitDeps {
  // Injected by tests so the request body/shape can be asserted and
  // rejection/timeout/non-2xx simulated without a live network call. Resolved
  // at call time (defaulting to `globalThis.fetch`) so a test that stubs the
  // global — as the Expo-fanout tests already do — is honored.
  fetch?: typeof fetch
}

/**
 * Emit a single product-analytics event to PostHog from the server.
 *
 * Enforcement order (mirrors the client `captureEvent`):
 *  1. Unknown event → return without sending (silent no-op).
 *  2. `POSTHOG_API_KEY` unset → return without sending (silent no-op).
 *  3. `validateEventProps` strips unpermitted keys.
 *  4. `applyContentSafetyNets` drops any surviving content key / free-text value.
 * Then POST `{ api_key, event, distinct_id, properties, timestamp }` to
 * `${POSTHOG_HOST ?? DEFAULT}/capture/`. Fail-open throughout: NEVER throws.
 */
export async function emitServerEvent(
  event: string,
  distinctId: string,
  props?: Record<string, unknown>,
  deps?: EmitDeps,
): Promise<void> {
  try {
    // (1) Unknown event — never send.
    const entry = (EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event]
    if (!entry) {
      return
    }

    // (2) Env gate — no key means no emission (dev/test/unconfigured).
    const apiKey = readEnv('POSTHOG_API_KEY')
    if (!apiKey) {
      return
    }

    // (3)+(4) Allowlist strip, then the two runtime nets.
    const { sanitizedProps } = validateEventProps(event, props)
    const finalProps = applyContentSafetyNets(sanitizedProps)

    const host = readEnv('POSTHOG_HOST') ?? DEFAULT_POSTHOG_HOST
    const url = `${host}/capture/`
    const body = JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: finalProps,
      timestamp: new Date().toISOString(),
    })

    const fetchFn = deps?.fetch ?? globalThis.fetch
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutMarker = Symbol('timeout')
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort()
        resolve(timeoutMarker)
      }, EMIT_TIMEOUT_MS)
    })

    try {
      const outcome = await Promise.race([
        // Wrapped so a synchronous throw from the (possibly stubbed) fetch
        // becomes a rejected promise this try/catch handles, rather than
        // escaping mid-race.
        Promise.resolve().then(() =>
          fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          })
        ),
        timeoutPromise,
      ])

      if (outcome === timeoutMarker) {
        logError('telemetry.emit.failed', { event, outcome: 'timeout' })
        return
      }

      const response = outcome as Response
      if (!response.ok) {
        logError('telemetry.emit.failed', { event, outcome: 'non_2xx' })
      }
    } catch {
      logError('telemetry.emit.failed', { event, outcome: 'error' })
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  } catch {
    // Absolute backstop: emitServerEvent must NEVER throw, whatever happens
    // above (including an unexpected failure in validation or logging).
    try {
      logError('telemetry.emit.failed', { event, outcome: 'error' })
    } catch {
      // Even logging failed — swallow. The caller's primary work is sacred.
    }
  }
}
