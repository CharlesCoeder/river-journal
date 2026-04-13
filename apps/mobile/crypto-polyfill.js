// Polyfill crypto.getRandomValues and crypto.subtle.digest for React Native.
// Must be imported before any module that uses crypto (e.g. Supabase PKCE,
// uuid for Legend-State sync IDs, @noble/* for E2E encryption).
import { getRandomValues, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'

if (!globalThis.crypto) {
  globalThis.crypto = {}
}

if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = getRandomValues
}

// Supabase auth checks for crypto.subtle.digest to decide between
// S256 and plain PKCE challenges. Without this, PKCE falls back to plain.
if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = {
    digest: async (algorithm, data) => {
      const algo =
        algorithm === 'SHA-256' || algorithm?.name === 'SHA-256'
          ? CryptoDigestAlgorithm.SHA256
          : undefined
      if (!algo) throw new Error(`Unsupported digest algorithm: ${algorithm}`)

      // Supabase passes TextEncoder-encoded Uint8Array — decode back to string
      // for expo-crypto's digestStringAsync which expects a string input.
      const str = new TextDecoder().decode(new Uint8Array(data))

      const hex = await digestStringAsync(algo, str)
      // Convert hex string to ArrayBuffer
      const bytes = new Uint8Array(hex.length / 2)
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
      }
      return bytes.buffer
    },
  }
}
