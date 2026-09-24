import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Fake server: the same merge semantics as merge_my_preferences ───────────
type Doc = Record<string, unknown>
const isObj = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v)
const UNION_KEYS = ['unlockedThemes', 'locallyHiddenPosts']

function fakeMerge(base: Doc, patch: Doc, depth = 0): Doc {
  const out: Doc = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (depth === 0 && key === 'feature_flags') continue
    if (depth === 0 && UNION_KEYS.includes(key) && Array.isArray(value)) {
      const current = Array.isArray(out[key]) ? (out[key] as unknown[]) : []
      out[key] = [...new Set([...current, ...value])]
    } else if (isObj(value) && isObj(out[key])) {
      out[key] = fakeMerge(out[key] as Doc, value, depth + 1)
    } else {
      out[key] = value
    }
  }
  return out
}

let serverDoc: Doc = {}
let rpcGate: Promise<void> | null = null
const rpcMock = vi.fn(async (_name: string, args: { patch: Doc }) => {
  if (rpcGate) await rpcGate
  serverDoc = fakeMerge(serverDoc, args.patch)
  return { data: structuredClone(serverDoc), error: null as { message: string } | null }
})

vi.mock('../../utils/supabase', () => ({
  supabase: {
    rpc: (...args: [string, { patch: Doc }]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../persistConfig', () => ({
  persistPlugin: {
    getTable: vi.fn(() => ({})),
    setTable: vi.fn(),
    deleteTable: vi.fn(),
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
    deleteMetadata: vi.fn(),
    loadTable: vi.fn(),
    saveTable: vi.fn(),
    set: vi.fn(),
  },
  configurePersistence: vi.fn(),
}))

import { store$, ensureProfile, setTheme } from '../store'
import { deviceState$ } from '../syncConfig'
import {
  diffDoc,
  fillMissing,
  projectProfile,
  sanitizeServerDoc,
  setAppearanceScope,
  stopPreferencesSync,
  syncPreferencesNow,
} from '../preferencesSync'
import type { UserProfile } from '../types'

const USER_A = 'user-a'
const USER_B = 'user-b'

function signIn(userId: string) {
  store$.session.assign({ userId, isAuthenticated: true })
}

function freshProfile(overrides: Partial<UserProfile> = {}) {
  store$.profile.set(null)
  ensureProfile()
  store$.profile.assign(overrides)
}

/** Marks this device as already in sync with the server for `userId`. */
function markSynced(userId: string) {
  store$.profile.preferencesSyncBase.set({ userId, doc: projectProfile(store$.profile.peek()) })
  serverDoc = structuredClone(projectProfile(store$.profile.peek())) as Doc
}

const patchesSent = () => rpcMock.mock.calls.map(([, args]) => args.patch)

beforeEach(() => {
  serverDoc = {}
  rpcGate = null
  rpcMock.mockClear()
  deviceState$.lastAuthedUserId.set(null)
  signIn(USER_A)
  freshProfile()
})

afterEach(() => {
  stopPreferencesSync()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('projectProfile', () => {
  it('includes account settings and appearance, never device-local fields', () => {
    freshProfile({
      themeName: 'night',
      hotkeyOverrides: { newEntry: 'Mod+J' },
      preferences: {
        locallyHiddenPosts: ['p1'],
        feature_flags: { external_billing_link_enabled: true },
        reminders: {
          streak: {
            enabled: true,
            local_time: '07:00',
            permissionPromptSeenAt: '2026-09-01T00:00:00Z',
            permissionLastDeniedAt: '2026-09-02T00:00:00Z',
          },
        },
      },
    })

    const doc = projectProfile(store$.profile.peek())

    expect(doc.appearance?.themeName).toBe('night')
    expect(doc.appearance?.fontPairing).toBe('outfit-newsreader')
    expect(doc.locallyHiddenPosts).toEqual(['p1'])
    expect(doc.reminders).toEqual({ streak: { enabled: true, local_time: '07:00' } })
    expect(doc).not.toHaveProperty('feature_flags')
    expect(doc).not.toHaveProperty('hotkeyOverrides')
    expect(doc).not.toHaveProperty('preferencesSyncBase')
    expect(doc).not.toHaveProperty('appearanceScope')
  })

  it('leaves appearance out when this device keeps its own look', () => {
    freshProfile({ appearanceScope: 'device' })
    expect(projectProfile(store$.profile.peek())).not.toHaveProperty('appearance')
  })
})

describe('diffDoc / fillMissing', () => {
  it('diffDoc returns only the changed leaves', () => {
    const base = { appearance: { themeName: 'ink', fontPairing: 'lato-lora' }, word_goal: 750 }
    const next = { appearance: { themeName: 'night', fontPairing: 'lato-lora' }, word_goal: 750 }
    expect(diffDoc(base, next)).toEqual({ appearance: { themeName: 'night' } })
    expect(diffDoc(base, base)).toBeNull()
  })

  it('diffDoc sends a custom theme whole, and ignores key order', () => {
    const base = { appearance: { customTheme: { bg: '#000', text: '#fff', stone: '#888' } } }
    expect(
      diffDoc(base, { appearance: { customTheme: { stone: '#888', text: '#fff', bg: '#000' } } })
    ).toBeNull()
    expect(
      diffDoc(base, { appearance: { customTheme: { bg: '#111', text: '#fff', stone: '#888' } } })
    ).toEqual({ appearance: { customTheme: { bg: '#111', text: '#fff', stone: '#888' } } })
  })

  it('fillMissing keeps the account value where it exists and fills the gaps', () => {
    const local = {
      appearance: { themeName: 'leather', fontPairing: 'lato-lora' },
      word_goal: 1000,
      unlockedThemes: ['night'],
    }
    const server = { appearance: { themeName: 'forest-night' }, unlockedThemes: ['fireside'] }
    expect(fillMissing(local, server)).toEqual({
      appearance: { fontPairing: 'lato-lora' },
      word_goal: 1000,
      unlockedThemes: ['night'],
    })
  })
})

describe('sanitizeServerDoc', () => {
  it('keeps well-formed values and drops everything else', () => {
    const doc = sanitizeServerDoc({
      word_goal: -5,
      unlockedThemes: ['night', 'not-a-theme', 'night'],
      appearance: { themeName: 'custom', customTheme: null, fontPairing: 'comic-sans' },
      reminders: {
        streak: { enabled: true, local_time: '25:99', last_local_offset_minutes: -300 },
        replies: { enabled: 'yes' },
      },
      moderationReceipts: { good: { acknowledged_at: '2026-09-01T00:00:00Z' }, bad: {} },
      feature_flags: { external_billing_link_enabled: true },
      somethingNew: 1,
    })

    expect(doc).toEqual({
      unlockedThemes: ['night'],
      appearance: { customTheme: null },
      reminders: { streak: { enabled: true, last_local_offset_minutes: -300 } },
      moderationReceipts: { good: { acknowledged_at: '2026-09-01T00:00:00Z' } },
      feature_flags: { external_billing_link_enabled: true },
    })
  })

  it('returns an empty document for a non-object', () => {
    expect(sanitizeServerDoc(null)).toEqual({})
    expect(sanitizeServerDoc(['x'])).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('syncPreferencesNow — incremental', () => {
  it('pushes only the leaf that changed', async () => {
    markSynced(USER_A)
    setTheme('night')

    await syncPreferencesNow()

    expect(patchesSent()).toEqual([{ appearance: { themeName: 'night' } }])
    expect(store$.profile.preferencesSyncBase.peek()?.doc.appearance?.themeName).toBe('night')
  })

  it('makes no request when nothing changed and no pull was asked for', async () => {
    markSynced(USER_A)
    await syncPreferencesNow()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('a pull applies another device’s changes and keeps this device’s prompt state', async () => {
    store$.profile.preferences.reminders.set({
      streak: { enabled: true, local_time: '20:00', permissionPromptSeenAt: '2026-09-01T00:00:00Z' },
    })
    markSynced(USER_A)
    serverDoc = fakeMerge(serverDoc, {
      reminders: { streak: { local_time: '06:30' } },
      moderationReceipts: { 'suspension:1': { acknowledged_at: '2026-09-10T00:00:00Z' } },
      feature_flags: { external_billing_link_enabled: true },
    })
    serverDoc.feature_flags = { external_billing_link_enabled: true }

    await syncPreferencesNow({ pull: true })

    expect(patchesSent()).toEqual([{}])
    const prefs = store$.profile.preferences.peek()
    expect(prefs?.reminders?.streak).toEqual({
      enabled: true,
      local_time: '06:30',
      permissionPromptSeenAt: '2026-09-01T00:00:00Z',
    })
    expect(prefs?.moderationReceipts).toHaveProperty('suspension:1')
    expect(prefs?.feature_flags).toEqual({ external_billing_link_enabled: true })
  })

  it('keeps an edit made while the request was in flight, then pushes it', async () => {
    markSynced(USER_A)
    serverDoc = fakeMerge(serverDoc, { word_goal: 900 })
    let release!: () => void
    rpcGate = new Promise((resolve) => {
      release = resolve
    })

    const done = syncPreferencesNow({ pull: true })
    setTheme('fireside')
    rpcGate = null
    release()
    await done

    expect(store$.profile.themeName.peek()).toBe('fireside')
    expect(store$.profile.word_goal.peek()).toBe(900)
    expect(patchesSent()).toEqual([{}, { appearance: { themeName: 'fireside' } }])
    expect((serverDoc.appearance as Doc).themeName).toBe('fireside')
  })

  it('does nothing when signed out', async () => {
    store$.session.assign({ userId: null, isAuthenticated: false })
    setTheme('night')
    await syncPreferencesNow({ pull: true })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('never throws on a server error and leaves the base untouched', async () => {
    markSynced(USER_A)
    const baseBefore = store$.profile.preferencesSyncBase.peek()
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never)
    setTheme('night')

    await expect(syncPreferencesNow()).resolves.toBeUndefined()

    expect(store$.profile.preferencesSyncBase.peek()).toEqual(baseBefore)
    expect(store$.profile.themeName.peek()).toBe('night')
  })
})

describe('syncPreferencesNow — first sync for an account on this device', () => {
  it('seeds: the account’s values win, and this device fills the gaps', async () => {
    serverDoc = { appearance: { themeName: 'forest-night' } }
    freshProfile({ themeName: 'leather', word_goal: 1000 })
    store$.profile.preferences.disclosures.collective_post_v1.set({
      acknowledged_at: '2026-09-01T00:00:00Z',
    })

    await syncPreferencesNow({ pull: true })

    expect(store$.profile.themeName.peek()).toBe('forest-night')
    expect(serverDoc.word_goal).toBe(1000)
    expect(serverDoc.disclosures).toEqual({
      collective_post_v1: { acknowledged_at: '2026-09-01T00:00:00Z' },
    })
    expect((serverDoc.appearance as Doc).themeName).toBe('forest-night')
    expect(store$.profile.preferencesSyncBase.peek()?.userId).toBe(USER_A)
  })

  it('adopts: a device last used by another account never leaks its data', async () => {
    freshProfile({ themeName: 'leather' })
    store$.profile.preferences.locallyHiddenPosts.set(['a-hidden-post'])
    store$.profile.preferences.disclosures.collective_post_v1.set({
      acknowledged_at: '2026-09-01T00:00:00Z',
    })
    markSynced(USER_A)

    serverDoc = { locallyHiddenPosts: ['b-hidden-post'], word_goal: 400 }
    signIn(USER_B)
    await syncPreferencesNow({ pull: true })

    const prefs = store$.profile.preferences.peek()
    expect(prefs?.locallyHiddenPosts).toEqual(['b-hidden-post'])
    expect(prefs?.disclosures).toBeUndefined()
    expect(store$.profile.word_goal.peek()).toBe(400)
    // B's account never received A's hidden posts or acknowledgments…
    expect(serverDoc.locallyHiddenPosts).toEqual(['b-hidden-post'])
    expect(serverDoc).not.toHaveProperty('disclosures')
    // …but this device's look, which B's account lacked, was sent on.
    expect((serverDoc.appearance as Doc).themeName).toBe('leather')
  })

  it('adopts when the device’s last signed-in account was someone else, even with no base', async () => {
    deviceState$.lastAuthedUserId.set(USER_A)
    store$.profile.preferences.locallyHiddenPosts.set(['a-hidden-post'])
    signIn(USER_B)

    await syncPreferencesNow({ pull: true })

    expect(store$.profile.preferences.peek()?.locallyHiddenPosts).toBeUndefined()
    expect(serverDoc).not.toHaveProperty('locallyHiddenPosts')
  })
})

describe('appearance scope', () => {
  it('a device-only look is neither pushed nor overwritten', async () => {
    markSynced(USER_A)
    setAppearanceScope('device')
    await syncPreferencesNow()
    rpcMock.mockClear()

    setTheme('fireside')
    serverDoc = fakeMerge(serverDoc, { appearance: { themeName: 'night' } })
    await syncPreferencesNow({ pull: true })

    expect(patchesSent()).toEqual([{}])
    expect(store$.profile.themeName.peek()).toBe('fireside')
  })

  it('switching back to the account adopts the account’s look instead of pushing this one', async () => {
    markSynced(USER_A)
    setAppearanceScope('device')
    serverDoc = fakeMerge(serverDoc, { appearance: { themeName: 'night' } })
    await syncPreferencesNow({ pull: true })
    setTheme('fireside')
    rpcMock.mockClear()

    setAppearanceScope('account')
    await syncPreferencesNow()

    expect(store$.profile.themeName.peek()).toBe('night')
    expect((serverDoc.appearance as Doc).themeName).toBe('night')
    expect(patchesSent().every((p) => !('appearance' in p))).toBe(true)
  })
})
