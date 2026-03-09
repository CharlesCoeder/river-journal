// Polyfill crypto.getRandomValues for React Native.
// Must be imported before any module that uses crypto.getRandomValues
// (uuid for Legend-State sync IDs, @noble/* for E2E encryption).
import { getRandomValues } from 'expo-crypto'

if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  if (!globalThis.crypto) {
    globalThis.crypto = {}
  }
  globalThis.crypto.getRandomValues = getRandomValues
}
