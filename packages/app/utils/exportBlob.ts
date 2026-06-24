/**
 * Web/Desktop export payload carrier.
 *
 * On the web a real `Blob` is the natural artifact: it powers
 * `URL.createObjectURL` in the download handler and supports `arrayBuffer()`.
 * The native counterpart (`exportBlob.native.ts`) cannot use a real Blob — see
 * that file for why — so this helper pair is the seam that keeps the shared
 * export pipeline platform-agnostic.
 */

/** Wrap raw export payload (zip bytes or markdown string) in a Blob. */
export function toExportBlob(data: Uint8Array | string, type: string): Blob {
  return new Blob([data], { type })
}

/** Read the raw bytes back out of an export blob. */
export async function exportBlobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}
