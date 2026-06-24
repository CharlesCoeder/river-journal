/**
 * React Native export payload carrier.
 *
 * React Native's core `Blob` can neither be constructed from a `Uint8Array`
 * ("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported")
 * nor read back via `blob.arrayBuffer()` (RN doesn't implement it). So on
 * native we never route binary through a real Blob: we carry the raw bytes on
 * a lightweight stand-in that exposes just the `type` field the rest of the app
 * reads, plus the bytes the native file writer needs.
 *
 * The stand-in is typed as `Blob` so the shared export pipeline's signatures
 * stay identical across platforms; only this file knows it isn't a real one.
 */
import { strToU8 } from 'fflate'

class ExportBlob {
  readonly type: string
  readonly bytes: Uint8Array
  constructor(data: Uint8Array | string, type: string) {
    this.type = type
    this.bytes = typeof data === 'string' ? strToU8(data) : data
  }
}

/** Wrap raw export payload (zip bytes or markdown string) in an export blob. */
export function toExportBlob(data: Uint8Array | string, type: string): Blob {
  return new ExportBlob(data, type) as unknown as Blob
}

/** Read the raw bytes back out of an export blob. */
export async function exportBlobToBytes(blob: Blob): Promise<Uint8Array> {
  return (blob as unknown as ExportBlob).bytes
}
