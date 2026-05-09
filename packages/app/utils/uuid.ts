// Cross-runtime UUID v4 generation.
//
// Hermes (React Native) does not implement crypto.randomUUID, so a naive
// `crypto.randomUUID()` call crashes on device. This helper prefers the
// native API when present and otherwise falls back to the `uuid` package
// after ensuring `crypto.getRandomValues` is wired up via the React Native
// polyfill installed by `assertCryptoGetRandomValues`.

import { v4 as uuidv4 } from 'uuid'
import { assertCryptoGetRandomValues } from './encryption'

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  assertCryptoGetRandomValues()
  return uuidv4()
}
