// Response envelope for Edge Functions.
//
// Every Edge Function returns either a success envelope `{ ok: true, ...data }`
// (status 200) or an error envelope `{ error, code? }` (a 4xx/5xx status). The
// client-facing body NEVER carries a stack trace, an Error.cause, or a raw
// exception — these functions are reachable at their public URL, so an internal
// detail leaked into the body is a real information-disclosure surface.

export interface ErrorOptions {
  code?: string
  status?: number
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

// ok(data?) -> 200 `{ ok: true, ...data }`.
//
// Callers pass ONLY data that is safe to hand back to whoever holds the bearer.
// In particular, notify_moderation_action must never spread a resolved
// affected-user id / post author into here (that would make the function a
// target_post_id -> author enumeration oracle); its success path calls `ok()`
// with no data at all.
export function ok(data?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...(data ?? {}) }), {
    status: 200,
    headers: JSON_HEADERS,
  })
}

// err(message, { code?, status = 400 }) -> `{ error, code? }` at the given
// status. Only the caller-supplied `message` and optional `code` ever reach the
// body — never an exception object, stack, or cause.
export function err(message: string, options: ErrorOptions = {}): Response {
  const { code, status = 400 } = options
  const body: { error: string; code?: string } = { error: message }
  if (code !== undefined) {
    body.code = code
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}
