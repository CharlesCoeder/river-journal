import { assertEquals } from 'jsr:@std/assert@1'
import { readBodyWithLimit } from './body.ts'

function request(body: BodyInit | null): Request {
  return new Request('http://localhost/fn', { method: 'POST', body })
}

Deno.test('returns the decoded text of a body within the cap', async () => {
  const result = await readBodyWithLimit(request('{"a":1}'), 100)
  assertEquals(result, { ok: true, text: '{"a":1}' })
})

Deno.test('an absent body reads as an empty string', async () => {
  const result = await readBodyWithLimit(
    new Request('http://localhost/fn', { method: 'POST' }),
    100
  )
  assertEquals(result, { ok: true, text: '' })
})

Deno.test('rejects on a Content-Length above the cap without reading the body', async () => {
  let pulled = false
  // highWaterMark 0: otherwise the stream pulls eagerly at construction and
  // the flag could not tell "helper read the body" from "queue pre-filled".
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        pulled = true
        controller.enqueue(new TextEncoder().encode('x'))
        controller.close()
      },
    },
    { highWaterMark: 0 }
  )
  // `new Request()` drops a caller-set Content-Length (forbidden header), so
  // model the server-delivered request structurally.
  const result = await readBodyWithLimit(
    { headers: new Headers({ 'content-length': '101' }), body: stream },
    100
  )
  assertEquals(result, { ok: false, reason: 'too_large' })
  assertEquals(pulled, false)
})

Deno.test('measures bytes, not UTF-16 code units — multi-byte text over the cap is rejected', async () => {
  // 40 characters, 120 bytes: passes a naive `.length > 100` check, fails a byte cap.
  const text = '€'.repeat(40)
  assertEquals(text.length, 40)
  const result = await readBodyWithLimit(request(text), 100)
  assertEquals(result, { ok: false, reason: 'too_large' })
})

Deno.test('stops reading a chunked (no Content-Length) body once the cap is passed', async () => {
  let chunksServed = 0
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      chunksServed++
      controller.enqueue(new Uint8Array(60))
      if (chunksServed >= 10) controller.close()
    },
  })
  const result = await readBodyWithLimit(request(stream), 100)
  assertEquals(result, { ok: false, reason: 'too_large' })
  // Two chunks (120 bytes) are enough to cross 100; the remaining eight are never pulled.
  assertEquals(chunksServed <= 3, true)
})

Deno.test('a body exactly at the cap is accepted', async () => {
  const text = 'a'.repeat(100)
  const result = await readBodyWithLimit(request(text), 100)
  assertEquals(result, { ok: true, text })
})

Deno.test('a stream that errors mid-read is reported as unreadable', async () => {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      controller.error(new Error('boom'))
    },
  })
  const result = await readBodyWithLimit(request(stream), 100)
  assertEquals(result, { ok: false, reason: 'unreadable' })
})
