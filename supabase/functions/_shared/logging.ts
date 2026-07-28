// Structured, content-redacted JSON logging for Edge Functions.
//
// Logs and telemetry must NEVER contain journal/post content or
// user-supplied free text (post bodies, moderation reasons, private notes).
// This logger enforces that structurally on TWO independent nets:
//   1. KEY net — every field whose key is in KNOWN_CONTENT_KEYS is stripped
//      before the line is serialized, AT ANY DEPTH and CASE-INSENSITIVELY
//      (`Body`, `POSTBODY`, `Reason` are all stripped — closing the
//      casing-rename escape). A top-level-only strip would leak free text
//      folded inside a nested object (e.g. `fields.metadata.note`), so
//      redaction recurses into every nested object/array.
//   2. VALUE net — any surviving string value that LOOKS like user prose
//      (long + many-worded, per looksLikeFreeText) is replaced with a redacted
//      marker even when it rides under an OFF-list key (e.g. `userNote`,
//      `draftText`). This catches content that renamed its way off the key
//      denylist.
// Callers should pass only safe metadata (IDs, counts, durations, action
// types, kinds) — and even if a caller accidentally passes a content key or
// free-text value nested anywhere, it is dropped.
//
// EXCLUSIVE LOGGING CONTRACT (CI-enforced):
//   `logInfo` / `logError` are the ONLY sanctioned logging path in Edge
//   Functions. Direct `console.*` is banned everywhere except THIS file (the
//   `console[method]` call in `emit` is the single sanctioned console site —
//   the wrapper implementation) and is enforced by
//   `scripts/lint-edge-function-logging.mjs`. That lint exempts exactly this
//   one file and nothing else.

import { isContentKey, KNOWN_CONTENT_KEYS, looksLikeFreeText } from './contentKeys.ts'

// Re-export the denylist so existing importers keep working unchanged and so
// there is exactly one source of truth (the list is owned by contentKeys.ts).
export { KNOWN_CONTENT_KEYS }

// Depth cap + cycle guard: without these, a deeply-nested or circular input
// (e.g. attacker-controlled JSON forwarded into a log field) could RangeError
// (stack overflow) or infinite-loop the recursion. MAX_DEPTH is generous for
// any legitimate structured-log payload; a value that exceeds it is replaced
// with a marker rather than serialized. A WeakSet tracks objects/arrays
// already visited on the current call so a circular reference resolves to a
// marker instead of recursing forever.
const MAX_DEPTH = 8

// Marker substituted for a string value caught by the free-text VALUE net.
const FREE_TEXT_MARKER = '[redacted:free-text]'

// Recursively strip every denylisted key from a value and neutralize any
// free-text-shaped string value. Objects are rebuilt without the banned keys
// (matched case-insensitively via isContentKey); nested objects/arrays are
// recursed into; surviving string values that look like user prose are
// replaced with a marker; other scalars pass through untouched. `depth` and
// `seen` are internal recursion state — callers should invoke redact(value)
// with no second/third argument.
export function redact(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (depth >= MAX_DEPTH) {
    return '[redacted:max-depth]'
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[redacted:circular]'
    }
    seen.add(value)
    return value.map((item) => redact(item, depth + 1, seen))
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[redacted:circular]'
    }
    seen.add(value as object)
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isContentKey(key)) {
        continue
      }
      out[key] = redact(nested, depth + 1, seen)
    }
    return out
  }
  // VALUE net: a string that survived the key check but looks like user prose
  // is content hiding under an off-list key — replace it with a marker.
  if (typeof value === 'string' && looksLikeFreeText(value)) {
    return FREE_TEXT_MARKER
  }
  return value
}

function emit(
  method: 'log' | 'error',
  level: 'info' | 'error',
  event: string,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    event,
    fields: redact(fields ?? {}),
    timestamp: new Date().toISOString(),
  })
  // The ONE sanctioned console call site in the entire Edge Function tree (see
  // the EXCLUSIVE LOGGING CONTRACT above). scripts/lint-edge-function-logging.mjs
  // exempts only this file.
  console[method](line)
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  emit('log', 'info', event, fields)
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  emit('error', 'error', event, fields)
}
