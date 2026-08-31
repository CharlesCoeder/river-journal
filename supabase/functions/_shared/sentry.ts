// sentry.ts — the server-side (Deno/Edge) operational-alert helper.
//
// The ONE sanctioned server alert path: `captureServerAlert`. It POSTs a single
// event to Sentry's envelope endpoint via a direct `fetch` (modeled on
// `_shared/expoPush.ts`) rather than pulling an SDK into the Deno bundle — one
// alert path does not justify a dependency.
//
// SCOPE: this is the server reporting on its own operational state (a
// backed-up moderation queue), so the payload is operator-authored message
// text plus aggregate counts. NO user data, NO content, NO user ids may ride
// an alert — the same content-key / free-text nets the logger applies
// (`_shared/contentKeys.ts`) are run over `extra` as defense in depth.
//
// FAIL-OPEN (non-negotiable): callers perform primary cron/DB work. A Sentry
// outage MUST NOT fail them. `captureServerAlert` swallows every error
// (network, non-2xx, timeout, missing config, malformed DSN) internally and
// resolves void — it NEVER throws and NEVER surfaces a value that could change
// a caller's control flow. A failure is logged metadata-only via `logError`.
//
// ENV-GATED: emission requires `SENTRY_DSN`. Unset (local dev, `deno test`, an
// unconfigured environment) is a silent no-op — no fetch, no failure. The
// operator sets `SENTRY_DSN` in the Supabase Edge Function secrets for alerts
// to fire in production.

import { isContentKey, looksLikeFreeText } from './contentKeys.ts'
import { logError } from './logging.ts'

// A short timeout so a slow/hung Sentry can never add meaningful latency to
// the cron tick the caller is completing.
const ALERT_TIMEOUT_MS = 3000

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
 * Resolve a Sentry DSN (`https://<publicKey>@<host>/<projectId>`) to its
 * envelope-ingest URL, authenticated via the `sentry_key` query parameter.
 * Returns undefined for a malformed DSN (missing key or project id) so the
 * caller can no-op rather than POST garbage.
 */
export function envelopeUrlFromDsn(dsn: string): string | undefined {
  try {
    const parsed = new URL(dsn)
    const publicKey = parsed.username
    const projectId = parsed.pathname.replace(/^\//, '')
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) {
      return undefined
    }
    return `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`
  } catch {
    return undefined
  }
}

/**
 * The same two redundant content nets the logger applies, over the alert's
 * `extra` payload: drop any key `isContentKey()` matches, and drop any string
 * value `looksLikeFreeText()` matches. Alerts carry aggregate counts, so in
 * practice nothing is ever dropped — the nets exist so a future call site
 * cannot accidentally ship content.
 */
export function sanitizeAlertExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
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

export interface AlertDeps {
  // Injected by tests so the envelope body/shape can be asserted and
  // rejection/timeout/non-2xx simulated without a live network call. Resolved
  // at call time (defaulting to `globalThis.fetch`) so a test that stubs the
  // global is honored.
  fetch?: typeof fetch
}

/**
 * Fire a single operational alert to Sentry from the server.
 *
 * Sends a minimal event envelope (three newline-delimited JSON lines: envelope
 * header, item header, event payload) with `level: "warning"`, the given
 * message, and net-sanitized `extra`. The fingerprint is pinned to the message
 * so repeated fires of the same alert group into one Sentry issue (alert
 * escalation dedupes) instead of one issue per cron tick. Fail-open
 * throughout: NEVER throws.
 */
export async function captureServerAlert(
  message: string,
  extra?: Record<string, unknown>,
  deps?: AlertDeps,
): Promise<void> {
  try {
    // Env gate — no DSN means no alert (dev/test/unconfigured).
    const dsn = readEnv('SENTRY_DSN')
    if (!dsn) {
      return
    }
    const url = envelopeUrlFromDsn(dsn)
    if (!url) {
      logError('telemetry.alert.failed', { outcome: 'bad_dsn' })
      return
    }

    const eventId = crypto.randomUUID().replaceAll('-', '')
    const timestamp = new Date().toISOString()
    const event = {
      event_id: eventId,
      timestamp,
      platform: 'javascript',
      level: 'warning',
      logger: 'edge',
      message: { formatted: message },
      extra: sanitizeAlertExtra(extra ?? {}),
      fingerprint: ['operational-alert', message],
    }
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: timestamp }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n')

    const fetchFn = deps?.fetch ?? globalThis.fetch
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutMarker = Symbol('timeout')
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort()
        resolve(timeoutMarker)
      }, ALERT_TIMEOUT_MS)
    })

    try {
      const outcome = await Promise.race([
        // Wrapped so a synchronous throw from the (possibly stubbed) fetch
        // becomes a rejected promise this try/catch handles, rather than
        // escaping mid-race.
        Promise.resolve().then(() =>
          fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body,
            signal: controller.signal,
          })
        ),
        timeoutPromise,
      ])

      if (outcome === timeoutMarker) {
        logError('telemetry.alert.failed', { outcome: 'timeout' })
        return
      }

      const response = outcome as Response
      if (!response.ok) {
        logError('telemetry.alert.failed', { outcome: 'non_2xx' })
      }
    } catch {
      logError('telemetry.alert.failed', { outcome: 'error' })
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  } catch {
    // Absolute backstop: captureServerAlert must NEVER throw, whatever happens
    // above (including an unexpected failure in sanitization or logging).
    try {
      logError('telemetry.alert.failed', { outcome: 'error' })
    } catch {
      // Even logging failed — swallow. The caller's primary work is sacred.
    }
  }
}
