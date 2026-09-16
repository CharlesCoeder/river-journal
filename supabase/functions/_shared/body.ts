/**
 * body.ts — bounded request-body reader shared by the user-JWT Edge Functions.
 *
 * `await req.text()` followed by a `.length` check is not a size guard: the
 * whole body is buffered before anything is measured, and `.length` counts
 * UTF-16 code units, so a body of multi-byte characters can be up to 4x the
 * declared byte cap before the check fires. This helper:
 *
 *   1. Rejects up front on a `Content-Length` header above the cap, before a
 *      single byte is read.
 *   2. Otherwise streams the body and stops reading the moment the running
 *      byte count passes the cap (chunked / unlabelled bodies are covered).
 *   3. Measures BYTES, decoding only what was accepted.
 *
 * Returns a discriminated result rather than throwing so each caller keeps
 * its own envelope wording; no logging here (nothing about the body is ever
 * logged — NFR19).
 */

export const DEFAULT_MAX_BODY_BYTES = 1_000_000

export type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable' }

/**
 * Structural subset of `Request` — everything the reader touches. Lets tests
 * hand in a plain `{ headers, body }` (the `Request` constructor strips a
 * caller-set `Content-Length` as a forbidden header, but a server-delivered
 * request carries it).
 */
export type ReadableRequest = Pick<Request, 'headers' | 'body'>

export async function readBodyWithLimit(
  req: ReadableRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<BodyReadResult> {
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const n = Number(declared)
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, reason: 'too_large' }
    }
  }

  const body = req.body
  if (body === null) {
    return { ok: true, text: '' }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    reader.releaseLock()
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8').decode(joined) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
