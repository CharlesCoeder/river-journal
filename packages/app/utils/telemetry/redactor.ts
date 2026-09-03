/**
 * redactor.ts — the pure function that IS the body of Sentry's `beforeSend`
 * on every platform (web / desktop / mobile share this ONE module). It is the
 * client-side enforcement point that guarantees user content never leaves the
 * device in a crash report.
 *
 * This module has NO SDK or platform-only imports on purpose: it is the only
 * part of the Sentry integration that can be unit-tested directly under Vitest
 * (the native SDK cannot load there), and it is imported by both the web and
 * native init wrappers so the redaction logic is defined exactly once.
 *
 * The event is typed structurally / loosely rather than against an SDK type so
 * this module stays SDK-free and robust to shape drift across SDK versions.
 *
 * TWO INDEPENDENT NETS (a value is redacted if EITHER fires):
 *  1. Known-key net: any value under a key that case-insensitively matches
 *     `KNOWN_CONTENT_KEYS` is redacted regardless of its type (string, number,
 *     nested object, array).
 *  2. Free-text net: any string ANYWHERE (including under an unknown key) that
 *     `looksLikeFreeText` flags as user prose is redacted.
 */

import { isContentKey, looksLikeFreeText } from './contentKeys'

/** Loose structural shape of a Sentry event — intentionally not the SDK type. */
type LooseEvent = Record<string, unknown>

export const REDACTED = '[redacted]'

/**
 * Recursively scrub a single JSON-ish value.
 *
 * @param value      the value to scrub
 * @param keyIsContent whether the KEY this value sits under matched a known
 *                     content key (net #1) — if so, the whole subtree is
 *                     redacted regardless of value type
 * @param seen       set of already-visited objects (circular-reference guard)
 */
function scrubValue(value: unknown, keyIsContent: boolean, seen: WeakSet<object>): unknown {
  // Net #1: the containing key is a known content key → redact wholesale.
  if (keyIsContent) return REDACTED

  // Net #2: free-text prose under ANY key (including unknown keys).
  if (typeof value === 'string') {
    return looksLikeFreeText(value) ? REDACTED : value
  }

  // Primitives (number/boolean/bigint/symbol) and null/undefined pass through
  // when the key is not a content key.
  if (value === null || typeof value !== 'object') {
    return value
  }

  // Circular-reference guard: if we've already walked this object, stop.
  if (seen.has(value as object)) return REDACTED
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, false, seen))
  }

  return scrubObject(value as LooseEvent, seen)
}

/** Walk an object, applying the known-key net per-key and recursing. */
function scrubObject(obj: LooseEvent, seen: WeakSet<object>): LooseEvent {
  const out: LooseEvent = {}
  for (const key of Object.keys(obj)) {
    out[key] = scrubValue(obj[key], isContentKey(key), seen)
  }
  return out
}

/**
 * Path segments that identify a single resource rather than name a route:
 * UUIDs (Supabase row ids), purely numeric ids, and long (16+ char) hex
 * tokens. Short alphabetic segments (`thread`, `journal`, `settings`) are
 * route names and pass through.
 */
const ID_SEGMENT_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})$/i

/**
 * Normalize a URL to its route pattern: every id-shaped path segment becomes
 * `[id]` and the query string / fragment are dropped entirely.
 *
 * WHY: `user.id` is attached to every event, so a preserved concrete URL
 * (`/collective/thread/<uuid>`) turns a crash report into "user X was reading
 * post Y" — a correlatable pair. The route pattern keeps the debugging signal
 * (which screen crashed) without the resource identity. The query string goes
 * wholesale because it can carry ids and campaign/click parameters that a
 * route pattern has no use for.
 *
 * Handles absolute and relative URLs; returns the input unchanged when it is
 * not parseable as either (never throws — redactEvent's contract).
 */
export function normalizeUrlToRoutePattern(url: string): string {
  let parsed: URL
  try {
    // Path-only URLs (`/thread/<id>`) need a base to parse; anything else must
    // parse on its own, so an arbitrary non-URL string passes through
    // unchanged instead of being mangled into a percent-encoded path.
    parsed = url.startsWith('/') ? new URL(url, 'relative://placeholder') : new URL(url)
  } catch {
    return url
  }
  const pattern = parsed.pathname
    .split('/')
    .map((segment) => (ID_SEGMENT_PATTERN.test(segment) ? '[id]' : segment))
    .join('/')
  return parsed.protocol === 'relative:' ? pattern : `${parsed.origin}${pattern}`
}

/**
 * Post-scrub step for the one standard field that legitimately holds a URL:
 * `event.request.url`. Runs on the rebuilt copy (never the caller's object).
 */
function normalizeRequestUrl(scrubbed: LooseEvent): void {
  const request = scrubbed.request
  if (request === null || typeof request !== 'object') return
  const url = (request as LooseEvent).url
  if (typeof url === 'string') {
    ;(request as LooseEvent).url = normalizeUrlToRoutePattern(url)
  }
}

/**
 * Post-scrub step: drop the SDK's `contexts.culture` block (locale, timezone,
 * calendar).
 *
 * WHY: unlike `user.geo` — which Sentry derives server-side from the request
 * IP and which no client hook can reach — the culture block is assembled in
 * the client from the browser/OS `Intl` APIs, so it IS within this redactor's
 * reach. It carries no debugging signal, while timezone + locale sitting
 * beside the stable `user.id` on every single event is gratuitous
 * fingerprinting surface for a private journaling app.
 *
 * Sibling contexts (`react`, `trace`, `browser`, ...) are left untouched.
 * Runs on the rebuilt copy (never the caller's object).
 */
function dropCultureContext(scrubbed: LooseEvent): void {
  const contexts = scrubbed.contexts
  if (contexts === null || typeof contexts !== 'object') return
  delete (contexts as LooseEvent).culture
}

/**
 * The `beforeSend` / `beforeSendTransaction` body. Scrubs the ENTIRE event
 * tree through both nets rather than a hardcoded allowlist of locations, so
 * content is stripped wherever it appears — including standard Sentry fields
 * that earlier revisions never visited (`request` url/query/body/headers/
 * cookies, `tags`, `transaction`, `spans[].description`/`.data`, `threads`,
 * `server_name`, and `exception.values[].stacktrace.frames[].vars`) and any
 * arbitrarily nested payload.
 *
 * A value is redacted if EITHER net fires (known content key, or free-text
 * prose). Short technical strings (error messages, ids, urls, route names)
 * and the Supabase `user.id` sit below the free-text floor and are preserved
 * for debugging. One targeted exception: `request.url` is additionally
 * normalized to its route pattern (`/collective/thread/<uuid>` →
 * `/collective/thread/[id]`, query string dropped) so the event's `user.id`
 * cannot be paired with a concrete resource identity. A second targeted
 * exception: `contexts.culture` (locale/timezone/calendar) is dropped
 * outright — see `dropCultureContext`.
 *
 * ROBUSTNESS: never throws (a throwing `beforeSend` drops the event, or
 * worse in some SDK versions sends it un-scrubbed), guards circular references,
 * and is idempotent (re-running on an already-redacted event is a no-op —
 * `[redacted]` is short + technical, so no net re-fires on it).
 */
export function redactEvent<T>(event: T): T {
  // Null/undefined/non-object events: return as-is (nothing to leak). A null
  // event still returns a defined value per the never-throw contract.
  if (event === null || event === undefined) return event
  if (typeof event !== 'object') return event

  try {
    const seen = new WeakSet<object>()
    // Recursively scrub the whole event. `scrubValue` rebuilds every object
    // and array as a fresh value, so the input is never mutated.
    const scrubbed = scrubValue(event, false, seen)
    if (scrubbed !== null && typeof scrubbed === 'object' && !Array.isArray(scrubbed)) {
      normalizeRequestUrl(scrubbed as LooseEvent)
      dropCultureContext(scrubbed as LooseEvent)
    }
    return scrubbed as T
  } catch {
    // Never let beforeSend throw. Fall back to a minimally-safe event: drop
    // every field that can carry content-bearing subtrees rather than risk
    // shipping them un-scrubbed.
    try {
      const source = event as LooseEvent
      const CONTENT_BEARING_FIELDS = new Set([
        'extra',
        'contexts',
        'breadcrumbs',
        'exception',
        'threads',
        'request',
        'tags',
        'transaction',
        'spans',
        'message',
      ])
      const safe: LooseEvent = {}
      for (const key of Object.keys(source)) {
        if (CONTENT_BEARING_FIELDS.has(key)) continue
        safe[key] = source[key]
      }
      return safe as T
    } catch {
      return {} as T
    }
  }
}
