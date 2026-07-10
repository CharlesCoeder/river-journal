/**
 * Local-only pending-return / pending-attestation markers.
 *
 * ASSUMED CONTRACT (see the account-gate feature's Dev Notes + "Project
 * Structure Notes", which names `packages/app/state/authReturn.ts` as the
 * suggested new-file path if a Legend-State observable is chosen over a raw
 * localStorage key):
 *
 *   - `pendingCollectiveReturn$: Observable<boolean>` — set true by the auth
 *     gate before navigating home; consumed by HomeScreen's home-forward
 *     effect (see `HomeScreen.collective-return.test.tsx`). Defaults false.
 *   - `pendingAgeAttestation$: Observable<boolean>` — set true before
 *     initiating Google-web/desktop OAuth; flushed once a session exists.
 *     Defaults false.
 *   - `flushPendingAgeAttestation(userId: string | null): Promise<void>` —
 *     the Google-web-redirect attestation flush: if the marker is pending
 *     AND a userId is present, call `recordAgeAttestation(userId)` and clear
 *     the marker; otherwise no-op and leave the marker untouched (an
 *     abandoned OAuth attempt — no session, no flush — must not lose the
 *     pending state).
 *
 * Both markers MUST be persisted local-only (never synced) — that wiring
 * (joining `initializeApp.ts`'s `isPersistLoaded` boot gate) is exercised at
 * the integration level via `HomeScreen.collective-return.test.tsx` and is
 * not re-asserted here.
 *
 * If the real implementation splits this differently (e.g. a raw
 * `localStorage` key, or the flush wired directly into `initializeApp.ts`
 * with no standalone helper), update the import path/shape below to match —
 * the marker defaults and flush semantics are the contract to satisfy. This
 * whole file is expected to fail at module resolution until
 * `state/authReturn.ts` exists (a valid red-phase signature).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRecordAgeAttestation = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('../../utils/auth', () => ({
  recordAgeAttestation: (...args: unknown[]) => mockRecordAgeAttestation(...args),
}))

import { pendingCollectiveReturn$, pendingAgeAttestation$, flushPendingAgeAttestation } from '../authReturn'

beforeEach(() => {
  vi.clearAllMocks()
  pendingCollectiveReturn$.set(false)
  pendingAgeAttestation$.set(false)
})

describe('pendingCollectiveReturn$ marker', () => {
  it('defaults to false', () => {
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })

  it('is settable and gettable', () => {
    pendingCollectiveReturn$.set(true)
    expect(pendingCollectiveReturn$.get()).toBe(true)
    pendingCollectiveReturn$.set(false)
    expect(pendingCollectiveReturn$.get()).toBe(false)
  })
})

describe('pendingAgeAttestation$ marker', () => {
  it('defaults to false', () => {
    expect(pendingAgeAttestation$.get()).toBe(false)
  })

  it('is settable and gettable', () => {
    pendingAgeAttestation$.set(true)
    expect(pendingAgeAttestation$.get()).toBe(true)
  })
})

describe('flushPendingAgeAttestation() — Google-web redirect attestation', () => {
  it('calls recordAgeAttestation and clears the marker when pending + a userId is present', async () => {
    pendingAgeAttestation$.set(true)
    await flushPendingAgeAttestation('user-1')
    expect(mockRecordAgeAttestation).toHaveBeenCalledWith('user-1')
    expect(pendingAgeAttestation$.get()).toBe(false)
  })

  it('does nothing when no attestation marker is pending', async () => {
    pendingAgeAttestation$.set(false)
    await flushPendingAgeAttestation('user-1')
    expect(mockRecordAgeAttestation).not.toHaveBeenCalled()
  })

  it('leaves the marker untouched and calls nothing when userId is null (abandoned OAuth)', async () => {
    pendingAgeAttestation$.set(true)
    await flushPendingAgeAttestation(null)
    expect(mockRecordAgeAttestation).not.toHaveBeenCalled()
    expect(pendingAgeAttestation$.get()).toBe(true)
  })
})
