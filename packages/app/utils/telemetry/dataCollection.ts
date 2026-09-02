/**
 * dataCollection.ts — the single, fully-explicit `dataCollection` object handed
 * to `Sentry.init` on every platform (web / desktop / mobile share this ONE
 * module, exactly like `redactor.ts`). SDK-free on purpose so it is importable
 * from shared code and unit-testable under Vitest.
 *
 * WHY EVERY FIELD IS SPELLED OUT — DO NOT PRUNE "REDUNDANT" ENTRIES:
 * in @sentry/core v10, `resolveDataCollectionOptions` switches its base
 * defaults the moment `dataCollection` is present AT ALL. With the option
 * absent, `sendDefaultPii: false` bridges to the strict set (`userInfo: false`
 * → `infer_ip: "never"`, empty bodies, PII-denylisted headers/cookies/query
 * params). With ANY `dataCollection` object present, unset fields instead fall
 * back to the permissive spec DEFAULTS — `userInfo: true`, which flips
 * `infer_ip` to `"auto"` and re-enables the IP collection this app explicitly
 * opts out of. A partial `{ stackFrameVariables: false }` would therefore be a
 * net privacy REGRESSION. Every field below restates the strict posture so the
 * resolved config cannot drift when the SDK's defaults change.
 */

/**
 * Header/cookie/query keys whose values must never ship. Mirrors the SDK's
 * internal `PII_HEADER_SNIPPETS` (not part of its public API, so restated
 * here): substrings matching forwarded-for chains, client IPs, and remote-user
 * identification headers.
 */
const PII_KEY_DENYLIST = ['forwarded', '-ip', 'remote-', 'via', '-user']

/**
 * The explicit data-collection posture, equal to or stricter than the
 * `sendDefaultPii: false` bridge in every field:
 *
 *  - `userInfo: false` — keeps `infer_ip: "never"` (the SDK instructs Relay
 *    not to derive an IP address from the connection). The load-bearing field.
 *  - `cookies: false` — stricter than the bridge's denylist; crash reports
 *    from this app never need cookie contents.
 *  - `httpHeaders` / `queryParams` — the bridge's PII denylist, restated.
 *  - `httpBodies: []` — no request/response body capture in any direction.
 *  - `genAI` — off; no such feature exists in this app, keep it structurally off.
 *  - `stackFrameVariables: false` — THE hardening change this module exists
 *    for. Local variables are the largest content-bearing channel into an
 *    event (`exception.values[].stacktrace.frames[].vars` can hold whatever a
 *    function had in scope, journal text included). The redactor does walk
 *    `vars`, but disabling collection closes the channel structurally instead
 *    of relying on a heuristic net.
 *  - `frameContextLines: 7` — preserves the pre-hardening amount of source
 *    context (our shipped code, not user data); omitting it would silently
 *    change behavior because the DEFAULTS base uses 5.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: PII_KEY_DENYLIST },
    response: { deny: PII_KEY_DENYLIST },
  },
  httpBodies: [],
  queryParams: { deny: PII_KEY_DENYLIST },
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
  frameContextLines: 7,
}
