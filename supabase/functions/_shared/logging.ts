// Structured, content-redacted JSON logging for Edge Functions.
//
// NFR19: logs and telemetry must NEVER contain journal/post content or
// user-supplied free text (post bodies, moderation reasons, private notes).
// This logger enforces that structurally: every field whose key is in
// KNOWN_CONTENT_KEYS is stripped before the line is serialized, AT ANY DEPTH.
// A top-level-only strip would leak free text folded inside a nested object
// (e.g. `fields.metadata.note`), so redaction recurses into every nested
// object/array. Callers should pass only safe metadata (IDs, counts,
// durations, action types, kinds) — and even if a caller accidentally passes a
// content key nested anywhere, it is dropped.

// The authoritative content-key denylist. This module AUTHORS it — there is no
// packages/app telemetry redactor to import from yet.
//
// A future Sentry beforeSend redactor must import/mirror this same set (this
// is the source of truth; the Sentry redactor mirrors it, not the reverse).
export const KNOWN_CONTENT_KEYS = [
  'body',
  'content',
  'flowContent',
  'postBody',
  'note',
  'reason',
  'reason_code',
  'title',
  'raw_receipt',
  'receipt',
] as const

const DENYLIST = new Set<string>(KNOWN_CONTENT_KEYS)

// Depth cap + cycle guard: without these, a deeply-nested or circular input
// (e.g. attacker-controlled JSON forwarded into a log field) could RangeError
// (stack overflow) or infinite-loop the recursion. MAX_DEPTH is generous for
// any legitimate structured-log payload; a value that exceeds it is replaced
// with a marker rather than serialized. A WeakSet tracks objects/arrays
// already visited on the current call so a circular reference resolves to a
// marker instead of recursing forever.
const MAX_DEPTH = 8

// Recursively strip every denylisted key from a value. Objects are rebuilt
// without the banned keys; nested objects/arrays are recursed into; scalars
// pass through untouched. `depth` and `seen` are internal recursion state —
// callers should invoke redact(value) with no second/third argument.
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
      if (DENYLIST.has(key)) {
        continue
      }
      out[key] = redact(nested, depth + 1, seen)
    }
    return out
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
  console[method](line)
}

export function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  emit('log', 'info', event, fields)
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  emit('error', 'error', event, fields)
}
