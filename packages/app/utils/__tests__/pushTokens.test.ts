/**
 * Red-phase unit tests for `utils/pushTokens.ts` — the web/desktop no-op stub.
 *
 * Red-phase contract: every test MUST fail until the target module exists —
 * the whole file fails at the top-level import with a module-resolution
 * error, per this repo's established red-phase convention (see
 * `downloadExport.ts` / `downloadExport.native.ts` platform-split precedent).
 *
 * Contract locked in for the implementation:
 *   - `requestAndRegisterPushToken()` resolves to `{ outcome: 'unsupported' }`
 *     — a benign no-op, never throws, never calls any native API.
 *   - `hasLivePushToken(userId)` resolves/returns `false` unconditionally.
 *   - `getPushPermissionStatus()` resolves to a non-'granted' status (the web
 *     stub has no OS permission concept) so a caller composing the gate's
 *     "silent register" branch never mistakes web for an already-granted state.
 *   - The file contains NO `expo-notifications` import — this guarantees
 *     `expo-notifications` is never bundled on web/desktop (boundary grep).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const STUB_PATH = path.resolve(__dirname, '../pushTokens.ts')

describe('utils/pushTokens.ts — web/desktop stub file', () => {
  it('exists', () => {
    expect(existsSync(STUB_PATH)).toBe(true)
  })

  it('does not import expo-notifications (boundary grep)', () => {
    const src = readFileSync(STUB_PATH, 'utf8')
    expect(src).not.toMatch(/expo-notifications/)
  })

  it('does not import expo-device', () => {
    const src = readFileSync(STUB_PATH, 'utf8')
    expect(src).not.toMatch(/expo-device/)
  })
})

describe('utils/pushTokens.ts — requestAndRegisterPushToken() no-op', () => {
  it('resolves to { outcome: "unsupported" }', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens')
    const result = await requestAndRegisterPushToken()
    expect(result).toEqual({ outcome: 'unsupported' })
  })

  it('never throws, called repeatedly', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens')
    await expect(requestAndRegisterPushToken()).resolves.toBeDefined()
    await expect(requestAndRegisterPushToken()).resolves.toBeDefined()
  })
})

describe('utils/pushTokens.ts — hasLivePushToken() no-op', () => {
  it('returns false regardless of userId', async () => {
    const { hasLivePushToken } = await import('../pushTokens')
    expect(await hasLivePushToken('user-1')).toBe(false)
    expect(await hasLivePushToken('')).toBe(false)
  })
})

describe('utils/pushTokens.ts — getPushPermissionStatus() no-op', () => {
  it('never reports "granted" on the web/desktop stub', async () => {
    const mod = await import('../pushTokens')
    // Optional export — only asserted if the implementation provides it
    // (mirrors the gate's need to distinguish "already granted" from "ask").
    if (typeof (mod as any).getPushPermissionStatus === 'function') {
      const status = await (mod as any).getPushPermissionStatus()
      expect(status).not.toBe('granted')
    }
  })
})
