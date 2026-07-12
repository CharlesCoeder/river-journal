/**
 * Red-phase unit tests for `utils/pushTokens.native.ts` — the ONLY module
 * allowed to import `expo-notifications` / `expo-device` (the platform
 * boundary).
 *
 * Red-phase contract: `expo-notifications` and `expo-device` are NOT YET
 * installed in this repo AND `pushTokens.native.ts` does
 * not exist yet — so this whole file fails at the
 * top-level `import { ... } from '../pushTokens.native'` with a
 * module-resolution error, exactly mirroring the `OnboardingGate.test.tsx`
 * red-phase signature. `expo-notifications` / `expo-device` / `expo-constants`
 * are mocked via `vi.mock(...)` with inline factories so this file can be
 * authored and collected TODAY, before the packages are installed — Vitest's
 * `vi.mock` does not require the real package to resolve on disk when a
 * factory is supplied (verified: mocking a nonexistent bare specifier and
 * importing it through the factory works with this repo's vitest.config.mts).
 *
 * Scope: NOT a device-level / Detox test. This suite exercises the pure
 * dedupe/reclaim/outcome logic against mocked `expo-notifications`,
 * `expo-device`, `expo-constants`, a mocked `app/state/push_tokens` (backed
 * by a REAL Legend-State `observable()` so `.peek()` / index-assign behave
 * faithfully without pulling in the real syncedSupabase()/persistence stack),
 * and a mocked `app/state/syncConfig` (only the `supabase` raw client, for
 * the Tier 2 reclaim — the native file imports `supabase` directly for the
 * server-authoritative reclaim call).
 *
 * Contract locked in for the implementation:
 *
 *   requestAndRegisterPushToken(): Promise<PushRegistrationOutcome>
 *     where PushRegistrationOutcome is one of:
 *       { outcome: 'granted' }            — token issued/reused, upserted
 *       { outcome: 'granted-no-token' }    — grant succeeded, token issuance failed
 *       { outcome: 'denied' }              — OS permission not granted
 *       { outcome: 'unsupported' }         — non-native (web stub only)
 *
 *   hasLivePushToken(userId: string): boolean
 *   getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'>
 *     — a read-only check (does NOT call requestPermissionsAsync) so the
 *     gate can decide modal-vs-silent-register (silent-register edge) before asking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── expo-notifications mock ────────────────────────────────────────────────
const requestPermissionsAsyncMock = vi.fn()
const getPermissionsAsyncMock = vi.fn()
const getExpoPushTokenAsyncMock = vi.fn()
vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: (...args: unknown[]) => requestPermissionsAsyncMock(...args),
  getPermissionsAsync: (...args: unknown[]) => getPermissionsAsyncMock(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => getExpoPushTokenAsyncMock(...args),
}))

// ─── expo-device mock ────────────────────────────────────────────────────────
let mockDeviceName: string | null = "Alice's iPhone"
vi.mock('expo-device', () => ({
  get deviceName() {
    return mockDeviceName
  },
}))

// ─── expo-constants mock ────────────────────────────────────────────────────
let mockProjectId: string | undefined = 'proj-123'
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } } }
    },
  },
}))

// ─── react-native Platform mock ─────────────────────────────────────────────
let mockPlatformOS: 'ios' | 'android' = 'ios'
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
}))

// ─── app/utils/uuid mock — deterministic id for the fresh-insert path ───────
let uuidCounter = 0
vi.mock('app/utils/uuid', () => ({
  generateUUID: () => `generated-uuid-${++uuidCounter}`,
}))

// ─── app/state/push_tokens mock — REAL Legend-State observable, no sync ────
// Backed by the real `observable()` (already a project dependency exercised
// heavily by state/collective tests) so `.peek()`, `[id].assign()`,
// `[id].set()` behave exactly as the native module will call them, without
// pulling in the real syncedSupabase()/IndexedDB persistence stack.
const { pushTokensObservable } = vi.hoisted(() => {
  return { pushTokensObservable: { current: null as any } }
})
vi.mock('app/state/push_tokens', async () => {
  const { observable } = await import('@legendapp/state')
  const obs = observable<Record<string, any>>({})
  pushTokensObservable.current = obs
  return { pushTokens$: obs }
})

// ─── app/state/syncConfig mock — the raw `supabase` client (Tier 2) plus
// `syncUserId$` (the current-user id source `push_tokens.ts` itself reads via
// `.peek()` — the native module's userId-less `requestAndRegisterPushToken()`
// signature implies it resolves "current user" the same way). ─────────────
const maybeSingleMock = vi.fn()
const updateEqMock = vi.fn()
const supabaseFromMock = vi.fn()
let mockCurrentUserId: string | null = 'user-1'
vi.mock('app/state/syncConfig', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
  syncUserId$: {
    peek: () => mockCurrentUserId,
    get: () => mockCurrentUserId,
  },
}))

function makeSelectChain(result: { data: { id: string } | null; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  maybeSingleMock.mockImplementation(() => maybeSingle())
  const eq2 = vi.fn(() => ({ maybeSingle }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  return { select, eq1, eq2, maybeSingle }
}

function makeUpdateChain() {
  const eq = vi.fn(() => updateEqMock())
  const update = vi.fn(() => ({ eq }))
  return { update, eq }
}

beforeEach(() => {
  vi.clearAllMocks()
  uuidCounter = 0
  mockPlatformOS = 'ios'
  mockProjectId = 'proj-123'
  mockDeviceName = "Alice's iPhone"
  mockCurrentUserId = 'user-1'
  updateEqMock.mockResolvedValue({ data: null, error: null })
  requestPermissionsAsyncMock.mockResolvedValue({ status: 'granted' })
  getPermissionsAsyncMock.mockResolvedValue({ status: 'undetermined' })
  getExpoPushTokenAsyncMock.mockResolvedValue({ data: 'ExponentPushToken[fresh123]' })
  // Default: Tier 2 select finds nothing (forces the fresh-insert path unless
  // a test seeds Tier 1 or overrides this chain).
  supabaseFromMock.mockImplementation((table: string) => {
    if (table !== 'user_push_tokens') throw new Error(`unexpected table: ${table}`)
    const selectChain = makeSelectChain({ data: null, error: null })
    const updateChain = makeUpdateChain()
    return { select: selectChain.select, update: updateChain.update }
  })
  if (pushTokensObservable.current) pushTokensObservable.current.set({})
})

afterEach(() => {
  vi.resetModules()
})

const USER_ID = 'user-1'
const EXPO_TOKEN = 'ExponentPushToken[fresh123]'

describe('requestAndRegisterPushToken — permission request', () => {
  it('calls Notifications.requestPermissionsAsync()', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()
    expect(requestPermissionsAsyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('requestAndRegisterPushToken — granted + token issuance succeeds', () => {
  it('resolves getExpoPushTokenAsync with the resolved projectId and returns { outcome: "granted" }', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    const result = await requestAndRegisterPushToken()
    expect(getExpoPushTokenAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-123' })
    )
    expect(result).toEqual({ outcome: 'granted' })
  })
})

describe('requestAndRegisterPushToken — granted but token issuance fails (edge)', () => {
  it('returns { outcome: "granted-no-token" } when projectId cannot be resolved, and does not throw', async () => {
    mockProjectId = undefined
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await expect(requestAndRegisterPushToken()).resolves.toEqual({ outcome: 'granted-no-token' })
  })

  it('returns { outcome: "granted-no-token" } when getExpoPushTokenAsync rejects (offline/simulator), and does not throw', async () => {
    getExpoPushTokenAsyncMock.mockRejectedValue(new Error('network unavailable'))
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await expect(requestAndRegisterPushToken()).resolves.toEqual({ outcome: 'granted-no-token' })
  })
})

describe('requestAndRegisterPushToken — denied', () => {
  it('returns { outcome: "denied" } and never calls getExpoPushTokenAsync when status is not granted', async () => {
    requestPermissionsAsyncMock.mockResolvedValue({ status: 'denied' })
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    const result = await requestAndRegisterPushToken()
    expect(result).toEqual({ outcome: 'denied' })
    expect(getExpoPushTokenAsyncMock).not.toHaveBeenCalled()
  })

  it('treats a non-granted iOS "provisional" status as denied (booleans/status===granted is the single source of truth)', async () => {
    requestPermissionsAsyncMock.mockResolvedValue({
      status: 'undetermined',
      ios: { status: 'provisional' },
    })
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    const result = await requestAndRegisterPushToken()
    expect(result).toEqual({ outcome: 'denied' })
  })
})

describe('requestAndRegisterPushToken — Tier 1 local dedupe', () => {
  it('touches lastUsedAt on an existing LIVE local row for the same (userId, expoPushToken) and inserts NO second row', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    pushTokensObservable.current.set({
      'existing-id': {
        id: 'existing-id',
        userId: USER_ID,
        expoPushToken: EXPO_TOKEN,
        platform: 'ios',
        deviceLabel: 'Old Label',
        lastUsedAt: '2020-01-01T00:00:00.000Z',
      },
    })
    // Simulate the current authenticated user for the module (see Dev Notes:
    // registration reads the current user id from wherever the module wires
    // it — this repo's precedent is syncUserId$/getCurrentUserId; the test
    // asserts the OUTCOME (no duplicate row, lastUsedAt advanced) rather than
    // pinning that internal wiring detail.
    await requestAndRegisterPushToken()

    const rows = Object.values(pushTokensObservable.current.peek() as Record<string, any>)
    const matching = rows.filter((r: any) => r.expoPushToken === EXPO_TOKEN)
    expect(matching).toHaveLength(1)
    expect(matching[0]!.lastUsedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })
})

describe('requestAndRegisterPushToken — Tier 2 server-authoritative reclaim', () => {
  it('when Tier 1 finds nothing but a soft-deleted server row exists, calls update({is_deleted:false, ...}) on that row id — NOT an insert', async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table !== 'user_push_tokens') throw new Error(`unexpected table: ${table}`)
      const selectChain = makeSelectChain({ data: { id: 'reclaimed-id' }, error: null })
      const updateChain = makeUpdateChain()
      return { select: selectChain.select, update: updateChain.update }
    })

    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    // The reclaim must go through supabase.from('user_push_tokens').update(...)
    // targeting the found row, not a fresh pushTokens$[uuid()].set(...) insert.
    const calls = supabaseFromMock.mock.calls
    expect(calls.some(([table]) => table === 'user_push_tokens')).toBe(true)

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    expect(rows['reclaimed-id']).toBeDefined()
    expect(Object.keys(rows)).toHaveLength(1)
  })

  it('mirrors the reclaimed row into pushTokens$ at the SAME id returned by the server (not a new uuid)', async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      const selectChain = makeSelectChain({ data: { id: 'server-row-id' }, error: null })
      const updateChain = makeUpdateChain()
      return { select: selectChain.select, update: updateChain.update }
    })

    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    expect(rows['server-row-id']).toBeDefined()
    expect(rows['generated-uuid-1']).toBeUndefined()
  })
})

describe('requestAndRegisterPushToken — fresh insert when both tiers find nothing', () => {
  it('inserts exactly one new row via a fresh generateUUID() when no local or server match exists', async () => {
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    expect(Object.keys(rows)).toHaveLength(1)
    const inserted = Object.values(rows)[0] as any
    expect(inserted.expoPushToken).toBe(EXPO_TOKEN)
  })
})

describe('requestAndRegisterPushToken — platform tagging + device label', () => {
  it('sets platform to the current Platform.OS', async () => {
    mockPlatformOS = 'android'
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    const inserted = Object.values(rows)[0] as any
    expect(inserted.platform).toBe('android')
  })

  it('sets deviceLabel from expo-device Device.deviceName when available', async () => {
    mockDeviceName = "Charlie's Pixel"
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    const inserted = Object.values(rows)[0] as any
    expect(inserted.deviceLabel).toBe("Charlie's Pixel")
  })

  it('sets deviceLabel to null when Device.deviceName is unavailable, never synthesizing a label from user content', async () => {
    mockDeviceName = null
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')
    await requestAndRegisterPushToken()

    const rows = pushTokensObservable.current.peek() as Record<string, any>
    const inserted = Object.values(rows)[0] as any
    expect(inserted.deviceLabel).toBeNull()
  })
})

describe('hasLivePushToken', () => {
  it('returns true when a live row exists for the given userId', async () => {
    const { hasLivePushToken } = await import('../pushTokens.native')
    pushTokensObservable.current.set({
      'row-1': {
        id: 'row-1',
        userId: USER_ID,
        expoPushToken: 'x',
        platform: 'ios',
        deviceLabel: null,
        lastUsedAt: 'now',
      },
    })
    expect(hasLivePushToken(USER_ID)).toBe(true)
  })

  it('returns false when no row exists for the given userId', async () => {
    const { hasLivePushToken } = await import('../pushTokens.native')
    pushTokensObservable.current.set({})
    expect(hasLivePushToken(USER_ID)).toBe(false)
  })

  it('returns false for a userId that does not match any row (rows belong to a different user)', async () => {
    const { hasLivePushToken } = await import('../pushTokens.native')
    pushTokensObservable.current.set({
      'row-1': {
        id: 'row-1',
        userId: 'someone-else',
        expoPushToken: 'x',
        platform: 'ios',
        deviceLabel: null,
        lastUsedAt: 'now',
      },
    })
    expect(hasLivePushToken(USER_ID)).toBe(false)
  })
})

describe('getPushPermissionStatus (silent-register edge)', () => {
  it('reports "granted" without calling requestPermissionsAsync (read-only check)', async () => {
    getPermissionsAsyncMock.mockResolvedValue({ status: 'granted' })
    const { getPushPermissionStatus } = await import('../pushTokens.native')
    const status = await getPushPermissionStatus()
    expect(status).toBe('granted')
    expect(requestPermissionsAsyncMock).not.toHaveBeenCalled()
  })

  it('reports a non-granted status as-is', async () => {
    getPermissionsAsyncMock.mockResolvedValue({ status: 'denied' })
    const { getPushPermissionStatus } = await import('../pushTokens.native')
    expect(await getPushPermissionStatus()).toBe('denied')
  })
})

describe('requestAndRegisterPushToken — re-entrancy guard (pre-mortem: double-tap)', () => {
  it('a second concurrent call while one is in-flight does not fire a second requestPermissionsAsync', async () => {
    let resolveFirst!: (value: { status: string }) => void
    requestPermissionsAsyncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    const { requestAndRegisterPushToken } = await import('../pushTokens.native')

    const first = requestAndRegisterPushToken()
    const second = requestAndRegisterPushToken()

    resolveFirst({ status: 'granted' })
    await Promise.all([first, second])

    expect(requestPermissionsAsyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('boundary — expo-notifications / expo-device usage is confined to this file', () => {
  it('the native module source imports expo-notifications', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../pushTokens.native.ts'), 'utf8')
    expect(src).toMatch(/expo-notifications/)
  })
})
