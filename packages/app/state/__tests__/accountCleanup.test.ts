/**
 * accountCleanup.test.ts — the post-deletion local-cleanup seam.
 *
 * Covers `runPostDeletionCleanup()`'s real contract (replacing the prior
 * stub): a two-phase local-store purge delegated to the carryover
 * `clearUserData()` helper, run BEFORE signing out (ordering is
 * load-bearing — the purge needs the still-live session to scope its
 * per-store nullification), and a persisted boot-resume flag that is
 * cleared ONLY on a clean completion so a mid-cleanup app close can retry
 * on next launch.
 *
 * `clearUserData()`'s own preserved-data behavior (anonymous local-only
 * writing, onboarding completion) is covered where that helper lives —
 * this file only asserts the seam calls it, in the right order, and reacts
 * correctly to both of its failure modes.
 *
 * Collaborators mocked at the module boundary: `app/utils`'s `signOut`,
 * `app/state/store`'s `clearUserData`, and `app/state/syncConfig`'s
 * `deviceState$` (getter-observable pattern — `vi.importActual` builds a
 * real observable so `.set()`/`.get()` behave exactly like the live store).
 *
 * Red-phase: `runPostDeletionCleanup()` today only calls `signOut()` then
 * unconditionally flips a flag on `ephemeral$` — it does not yet call
 * `clearUserData()`, does not yet reorder around it, does not yet read
 * `deviceState$`, and does not yet fail closed on error. Every test below
 * that depends on those behaviors fails until the seam is rewritten.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── app/utils — the signOut() wrapper the seam delegates session teardown to ─
const signOutMock = vi.fn()
vi.mock('app/utils', () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}))

// ─── app/state/store — the carryover two-phase local-store purge helper ──────
const clearUserDataMock = vi.fn()
vi.mock('app/state/store', () => ({
  clearUserData: (...args: unknown[]) => clearUserDataMock(...args),
}))

// ─── app/state/syncConfig — the persisted, device-scoped boot-resume flag ────
// Built via vi.importActual so the REAL Legend-State observable reactivity
// works (mirrors the DeleteAccountFlow.test.tsx getter-observable precedent).
vi.mock('app/state/syncConfig', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  const pendingAccountCleanup$ = observable(false)
  return {
    deviceState$: {
      pendingAccountCleanup: pendingAccountCleanup$,
    },
  }
})

import { runPostDeletionCleanup } from '../accountCleanup'
import { deviceState$ } from 'app/state/syncConfig'

const pendingAccountCleanup$ = deviceState$.pendingAccountCleanup

// Tracks the relative firing order of the two side effects across a single
// invocation of the seam.
let callOrder: string[]

beforeEach(() => {
  callOrder = []
  clearUserDataMock.mockReset().mockImplementation(() => {
    callOrder.push('clearUserData')
  })
  signOutMock.mockReset().mockImplementation(async () => {
    callOrder.push('signOut')
    return { error: null }
  })
  // The writer (the confirmation flow) sets this true FIRST, synchronously,
  // before firing the seam — simulate that precondition here.
  pendingAccountCleanup$.set(true)
})

describe('runPostDeletionCleanup — ordering (session must still be live for the purge to scope correctly)', () => {
  it('calls clearUserData() BEFORE signOut()', async () => {
    await runPostDeletionCleanup()

    expect(callOrder).toEqual(['clearUserData', 'signOut'])
  })
})

describe('runPostDeletionCleanup — delegates the purge, does not reimplement it', () => {
  it('invokes clearUserData() exactly once, with no arguments', async () => {
    await runPostDeletionCleanup()

    expect(clearUserDataMock).toHaveBeenCalledTimes(1)
    expect(clearUserDataMock).toHaveBeenCalledWith()
  })

  it('invokes signOut() exactly once on a clean run', async () => {
    await runPostDeletionCleanup()

    expect(signOutMock).toHaveBeenCalledTimes(1)
  })
})

describe('runPostDeletionCleanup — happy path', () => {
  it('clears the persisted boot-resume flag only after both steps complete cleanly', async () => {
    expect(pendingAccountCleanup$.get()).toBe(true)

    await runPostDeletionCleanup()

    expect(pendingAccountCleanup$.get()).toBe(false)
  })

  it('resolves without throwing on a clean run', async () => {
    await expect(runPostDeletionCleanup()).resolves.toBeUndefined()
  })
})

describe('runPostDeletionCleanup — failure semantics (boot-resume retry contract)', () => {
  it('signOut() returning a non-null error leaves the flag set AND rejects the seam promise', async () => {
    signOutMock.mockImplementation(async () => {
      callOrder.push('signOut')
      return { error: 'network unreachable' }
    })

    await expect(runPostDeletionCleanup()).rejects.toBeTruthy()

    expect(pendingAccountCleanup$.get()).toBe(true)
  })

  it('clearUserData() throwing leaves the flag set AND rejects the seam promise', async () => {
    clearUserDataMock.mockImplementation(() => {
      callOrder.push('clearUserData')
      throw new Error('local store purge failed')
    })

    await expect(runPostDeletionCleanup()).rejects.toBeTruthy()

    expect(pendingAccountCleanup$.get()).toBe(true)
  })

  it('a clearUserData() throw does not prevent signOut() from still being attempted (best-effort session teardown)', async () => {
    clearUserDataMock.mockImplementation(() => {
      callOrder.push('clearUserData')
      throw new Error('local store purge failed')
    })

    await runPostDeletionCleanup().catch(() => {})

    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('a clean clearUserData() but a failing signOut() still counts the run as failed (flag stays set, rejects)', async () => {
    signOutMock.mockImplementation(async () => {
      callOrder.push('signOut')
      return { error: 'session revoke failed' }
    })

    await expect(runPostDeletionCleanup()).rejects.toBeTruthy()

    expect(clearUserDataMock).toHaveBeenCalledTimes(1)
    expect(pendingAccountCleanup$.get()).toBe(true)
  })
})

describe('module boundary — Legend-State subtree constraint', () => {
  it('does not import @tanstack/react-query (signOut already tears down the query cache internally)', () => {
    const source = readFileSync(path.resolve(__dirname, '../accountCleanup.ts'), 'utf8')

    expect(source).not.toMatch(/@tanstack\/react-query/)
  })
})
