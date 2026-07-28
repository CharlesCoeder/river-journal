/**
 * Boundary-grep regression guard for the push-token platform split.
 *
 * Two independent greps that keep the platform boundary intact:
 *   1. `state/push_tokens.ts` (the platform-agnostic substrate) must never
 *      import `@tanstack/react-query`, `utils/encryption`, or
 *      `expo-notifications` — it is the platform-agnostic Legend-State
 *      observable; the native SDK is confined to `utils/pushTokens.native.ts`.
 *   2. `utils/pushTokens.ts` (the web/desktop no-op stub) must never import
 *      `expo-notifications` — this is what guarantees the SDK is never bundled
 *      on web/desktop (Metro picks `.native.ts`, Next/Tamagui picks `.ts`).
 *
 * Item 1 targets a file that already exists and is not expected to change here
 * (confirmed: `state/push_tokens.ts` has no such imports) and exists as an
 * ongoing regression guard.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const STATE_DIR = path.resolve(__dirname, '..')
const UTILS_DIR = path.resolve(__dirname, '../../utils')

// Forbidden imports: @tanstack/react-query | utils/encryption | encrypt | cipher | expo-notifications
const PUSH_TOKENS_STATE_FORBIDDEN =
  /@tanstack\/react-query|utils\/encryption|encrypt|cipher|expo-notifications/

describe('Boundary grep — state/push_tokens.ts stays platform-agnostic', () => {
  it('push_tokens.ts exists', () => {
    expect(existsSync(path.join(STATE_DIR, 'push_tokens.ts'))).toBe(true)
  })

  it('contains none of @tanstack/react-query, utils/encryption, encrypt, cipher, or expo-notifications', () => {
    const src = readFileSync(path.join(STATE_DIR, 'push_tokens.ts'), 'utf8')
    expect(src).not.toMatch(PUSH_TOKENS_STATE_FORBIDDEN)
  })
})

describe('Boundary grep — utils/pushTokens.ts (web/desktop stub) never imports expo-notifications', () => {
  it('pushTokens.ts exists', () => {
    expect(existsSync(path.join(UTILS_DIR, 'pushTokens.ts'))).toBe(true)
  })

  it('contains no expo-notifications import', () => {
    const src = readFileSync(path.join(UTILS_DIR, 'pushTokens.ts'), 'utf8')
    expect(src).not.toMatch(/expo-notifications/)
  })
})
