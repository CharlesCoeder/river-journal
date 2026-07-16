// @vitest-environment happy-dom
/**
 * BackupRestore.e2e.test.tsx — TDD red-phase E2E tests for the encrypted
 * local backup create/restore workflow, exercised end-to-end through the
 * real `BackupRestore` settings component.
 *
 * Red-phase contract: `packages/app/features/settings/components/BackupRestore.tsx`
 * does not exist yet (nor do the pure serializer/planner or crypto-envelope
 * modules it depends on) — this whole file fails at the top-level `import`
 * with a module-resolution error until they are created, per this repo's
 * established red-phase convention (see `AppLockSettings.e2e.test.tsx`).
 *
 * Mirrors `DayViewScreen.search.e2e.test.tsx` and `AppLockSettings.e2e.test.tsx`:
 * the component is mounted with the REAL `app/state/store` / `entries$` /
 * `flows$` observables (ownership scoping and additive-merge correctness are
 * first-class contracts here, so a mocked store would hide real bugs) and the
 * REAL `app/utils/encryption` module — with ONLY the expensive scrypt KDF
 * entry point (`deriveMasterKeyFromPassword`) swapped for a fast deterministic
 * stand-in. Salt generation and the real XChaCha20-Poly1305 AEAD cipher stay
 * real, so wrong-passphrase / tampered-ciphertext failures are genuinely
 * exercised (not simulated), without paying real N=2**17 scrypt cost per test.
 *
 * Only true externals are mocked: `app/utils/supabase` (no-network proof),
 * `app/utils/downloadExport` (delivery seam — inspect blob/filename instead of
 * touching a real DOM anchor), `app/utils/readBackupFile` (the new file-pick
 * seam — platform-specific, mocked at its bare import specifier regardless of
 * which platform file it would resolve to), and `@my/ui` (passthrough).
 *
 * Full round trips in this file drive the REAL UI twice — once to CREATE a
 * backup (capturing the real ciphertext `downloadExport` receives) and once to
 * RESTORE it (feeding that captured ciphertext back in via the mocked
 * `readBackupFile`) — so these are genuine create→restore round trips through
 * production crypto/serialization code, not mock-verifies-mock.
 *
 * ASSUMED CONTRACT (the story pins the behavior precisely but not every
 * literal selector; chosen to mirror this repo's existing conventions —
 * flag for the implementer/QA to reconcile if a different shape is chosen):
 *   - Idle-state entry points: testID `backup-create-open` ("Create encrypted
 *     backup") and `backup-restore-open` ("Restore from backup"), both
 *     rendered unconditionally (never auth-gated).
 *   - The unrecoverable-passphrase honesty copy is always visible in the idle
 *     state and matches /cannot be recovered/i (exact wording not pinned).
 *   - Create form: `backup-create-passphrase-input`,
 *     `backup-create-passphrase-confirm-input`, `backup-create-submit`.
 *     A blocked submit (too short / mismatched) never calls `downloadExport`;
 *     an optional inline block message may render at testID `backup-create-error`.
 *   - Restore flow: activating `backup-restore-open` immediately invokes
 *     `readBackupFile()`; a non-null result reveals
 *     `backup-restore-passphrase-input` + `backup-restore-submit`. Success
 *     renders `backup-restore-summary` (containing the "N restored, M skipped"
 *     counts); any decrypt/parse/shape failure renders `backup-restore-error`
 *     with calm copy and performs zero writes.
 *   - No spinner/progress-bar element (`role="progressbar"` or a
 *     `data-testid` containing "spinner") ever renders on either path.
 *
 * Out of scope for this file (not observable user-workflow behavior):
 *   - The pure `backupJournal.ts` module's own decidable surface (duplicate
 *     ids collapsing WITHIN a single hand-crafted payload, unknown
 *     `schemaVersion` rejection) requires crafting a payload from the
 *     module's internals directly — that is `backupJournal.test.ts`'s job
 *     per the story's own test-file breakdown, not this E2E file's. The
 *     "duplicate ids across restore-vs-existing-local-state" user workflow
 *     (which IS observable end-to-end) is covered below instead.
 *   - The Privacy Center PLACEMENT of this component (staggered section,
 *     `SECTION_COUNT` bump, non-disturbance of sibling sections) is covered
 *     by the sibling `PrivacyCenterScreen.backupRestore.e2e.test.tsx`.
 *   - The project-level regression/hygiene gate (typecheck/build/biome/
 *     boundary-greps) is not a user workflow and isn't duplicated here.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Entry, Flow } from 'app/state/types'

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted() — spies referenced inside vi.mock factories below.
// ─────────────────────────────────────────────────────────────────────────────
const { rpcMock, fromMock, mockDownloadExport, mockReadBackupFile, kdfSpy } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  mockDownloadExport: vi.fn().mockResolvedValue(undefined),
  mockReadBackupFile: vi.fn(),
  kdfSpy: vi.fn(),
}))

// ─── app/utils/supabase — no-network proof + keeps the real store module
// import from touching a real Supabase client. ──────────────────────────────
vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))

// ─── app/utils/encryption — real module, ONLY the expensive KDF swapped for
// a fast deterministic stand-in (mirrors AppLockSettings.e2e.test.tsx). ─────
vi.mock('app/utils/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/utils/encryption')>()
  const { createHash } = await import('node:crypto')
  return {
    ...actual,
    deriveMasterKeyFromPassword: async (password: string, saltB64: string) => {
      kdfSpy(password, saltB64)
      return new Uint8Array(createHash('sha256').update(`${password}::${saltB64}`).digest())
    },
  }
})

// ─── Delivery + file-pick seams — mocked so tests never touch a real DOM
// anchor/URL.createObjectURL or a real file picker, and so calls/results are
// inspectable and controllable. ──────────────────────────────────────────────
vi.mock('app/utils/downloadExport', () => ({
  downloadExport: (...args: unknown[]) => mockDownloadExport(...args),
}))
vi.mock('app/utils/readBackupFile', () => ({
  readBackupFile: () => mockReadBackupFile(),
}))

// ─── @my/ui — passthrough preserving testID/onPress, plus an Input
// (testID/value/onChangeText contract, mirroring ExportJournal.test.tsx /
// AppLockSettings.e2e.test.tsx). ─────────────────────────────────────────────
vi.mock('@my/ui', async () => {
  const ReactModule = await import('react')

  const mapProps = (props: Record<string, unknown>) => {
    const { testID, onPress, ...rest } = props as Record<string, unknown> & {
      testID?: string
      onPress?: () => void
    }
    const out: Record<string, unknown> = { ...rest }
    if (testID) out['data-testid'] = testID
    if (onPress) out.onClick = onPress
    return out
  }

  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      ReactModule.createElement(tag, mapProps(props), children)

  const Input = ({ testID, value, onChangeText, secureTextEntry }: any) =>
    ReactModule.createElement('input', {
      ...(testID ? { 'data-testid': testID } : {}),
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
      type: secureTextEntry ? 'password' : 'text',
    })

  return {
    AnimatePresence: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    Circle: passthrough('span'),
    Input,
    ScrollView: passthrough('div'),
    Text: passthrough('span'),
    View: passthrough('div'),
    XStack: passthrough('div'),
    YStack: passthrough('div'),
  }
})

// ─── Import under test — real component + real store, fails until
// BackupRestore.tsx and its dependencies exist. ─────────────────────────────
import { BackupRestore } from '../BackupRestore'
import { store$ } from 'app/state/store'
import { entries$ } from 'app/state/entries'
import { flows$ } from 'app/state/flows'
import { isSyncReady$ } from 'app/state/syncConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture / seeding helpers — build raw Entry/Flow records (not
// DailyEntryView) so the real store$ computed joins them exactly as
// production data flows.
// ─────────────────────────────────────────────────────────────────────────────
const CURRENT_USER = 'user-current'
const OTHER_USER = 'user-other'

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function makeEntryAndFlow(
  date: string,
  content: string,
  userId: string | null
): { entry: Entry; flow: Flow } {
  const entryId = nextId('entry')
  const flowId = nextId('flow')
  return {
    entry: {
      id: entryId,
      entryDate: date,
      lastModified: `${date}T12:00:00.000Z`,
      user_id: userId,
      local_session_id: 'test-session',
    },
    flow: {
      id: flowId,
      dailyEntryId: entryId,
      timestamp: `${date}T12:00:00.000Z`,
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      user_id: userId,
      local_session_id: 'test-session',
    },
  }
}

function extraFlow(entryId: string, date: string, content: string, userId: string | null): Flow {
  return {
    id: nextId('flow'),
    dailyEntryId: entryId,
    timestamp: `${date}T18:00:00.000Z`,
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    user_id: userId,
    local_session_id: 'test-session',
  }
}

function dateFor(i: number): string {
  return new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
}

function seedStore(pairs: ReturnType<typeof makeEntryAndFlow>[], extra: Flow[] = []): void {
  const entriesObj: Record<string, Entry> = {}
  const flowsObj: Record<string, Flow> = {}
  for (const { entry, flow } of pairs) {
    entriesObj[entry.id] = entry
    flowsObj[flow.id] = flow
  }
  for (const f of extra) flowsObj[f.id] = f
  entries$.set(entriesObj)
  flows$.set(flowsObj)
}

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function randBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n)
  for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256)
  return arr
}

/** A well-formed-but-garbage rj:backup:v1: envelope — fails AEAD auth for any passphrase. */
function makeGarbageBackupEnvelope(): string {
  const envelope = {
    version: 1,
    algorithm: 'xchacha20poly1305',
    salt: b64(randBytes(32)),
    nonce: b64(randBytes(24)),
    ciphertext: b64(randBytes(48)),
  }
  return `rj:backup:v1:${JSON.stringify(envelope)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Render / interaction helpers
// ─────────────────────────────────────────────────────────────────────────────
function renderBackupRestore() {
  return render(React.createElement(BackupRestore))
}

function openCreateForm() {
  fireEvent.click(screen.getByTestId('backup-create-open'))
}

function fillCreatePassphrase(pass: string, confirm = pass) {
  fireEvent.change(screen.getByTestId('backup-create-passphrase-input'), {
    target: { value: pass },
  })
  fireEvent.change(screen.getByTestId('backup-create-passphrase-confirm-input'), {
    target: { value: confirm },
  })
}

async function submitCreate() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('backup-create-submit'))
  })
}

async function createBackup(pass: string, confirm = pass) {
  openCreateForm()
  fillCreatePassphrase(pass, confirm)
  await submitCreate()
}

function lastDownloadCall(): { blob: Blob; filename: string } {
  const calls = mockDownloadExport.mock.calls
  const call = calls[calls.length - 1] as [Blob, string]
  return { blob: call[0], filename: call[1] }
}

async function fullRoundTripCreate(pass: string): Promise<string> {
  await createBackup(pass)
  await waitFor(() => expect(mockDownloadExport).toHaveBeenCalled())
  const { blob } = lastDownloadCall()
  return blob.text()
}

async function startRestoreWithFile(fileText: string | null) {
  mockReadBackupFile.mockResolvedValueOnce(fileText)
  await act(async () => {
    fireEvent.click(screen.getByTestId('backup-restore-open'))
  })
}

async function submitRestorePassphrase(pass: string) {
  fireEvent.change(screen.getByTestId('backup-restore-passphrase-input'), {
    target: { value: pass },
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('backup-restore-submit'))
  })
}

function freshDevice() {
  cleanup()
  entries$.set({})
  flows$.set({})
}

function expectNoSpinner() {
  expect(document.querySelector('[role="progressbar"]')).toBeNull()
  expect(document.querySelector('[data-testid*="spinner" i]')).toBeNull()
}

// ─────────────────────────────────────────────────────────────────────────────
// Test isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  idCounter = 0
  mockDownloadExport.mockClear()
  mockReadBackupFile.mockReset()
  kdfSpy.mockClear()
  rpcMock.mockClear()
  fromMock.mockClear()
  entries$.set({})
  flows$.set({})
  store$.session.userId.set(CURRENT_USER)
  isSyncReady$.set(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ═════════════════════════════════════════════════════════════════════════
// Entry points + honest copy, available to every user (no auth gate)
// ═════════════════════════════════════════════════════════════════════════
describe('Encrypted backup entry points are available to every user, with honest passphrase-only copy', () => {
  it('shows both the Create and Restore entry points for an anonymous (no-account) session', () => {
    store$.session.userId.set(null)
    renderBackupRestore()
    expect(screen.getByTestId('backup-create-open')).toBeTruthy()
    expect(screen.getByTestId('backup-restore-open')).toBeTruthy()
  })

  it('states plainly that the backup is protected by the passphrase alone and cannot be recovered without it', () => {
    renderBackupRestore()
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// The rj:backup:v1: crypto envelope, reusing the existing pipeline
// ═════════════════════════════════════════════════════════════════════════
describe('The delivered backup file is an encrypted rj:backup:v1: envelope, never plaintext', () => {
  it('delivers ciphertext carrying the rj:backup:v1: prefix, not the plaintext journal content', async () => {
    const distinctive = 'plaintext-should-never-appear-in-ciphertext-marker'
    seedStore([makeEntryAndFlow('2026-04-10', distinctive, CURRENT_USER)])
    renderBackupRestore()
    await createBackup('longpassphrase1')
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalled())

    const { blob } = lastDownloadCall()
    const text = await blob.text()
    expect(text.startsWith('rj:backup:v1:')).toBe(true)
    expect(text).not.toContain(distinctive)
  })

  it('generates a fresh salt/nonce per export — two exports of the same corpus produce different ciphertext', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'same content both times', CURRENT_USER)])
    renderBackupRestore()
    await createBackup('longpassphrase1')
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalledTimes(1))
    const first = await lastDownloadCall().blob.text()
    mockDownloadExport.mockClear()

    cleanup()
    renderBackupRestore()
    await createBackup('longpassphrase1')
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalledTimes(1))
    const second = await lastDownloadCall().blob.text()

    expect(first).not.toBe(second)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Create flow: passphrase entered twice (min 8), dated filename, ciphertext
// only, empty-corpus edge case, no spinner
// ═════════════════════════════════════════════════════════════════════════
describe('Creating a backup: passphrase entered twice (min 8), dated filename, ciphertext-only delivery', () => {
  it('blocks and never downloads when the passphrase is under 8 characters (7-char boundary)', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'some content', CURRENT_USER)])
    renderBackupRestore()
    await createBackup('short12') // 7 chars
    expect(mockDownloadExport).not.toHaveBeenCalled()
  })

  it('accepts an 8-character passphrase (boundary) and proceeds to create the file', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'some content', CURRENT_USER)])
    renderBackupRestore()
    await createBackup('eightch1') // 8 chars
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalledTimes(1))
  })

  it('blocks and never downloads when the two passphrase entries do not match', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'some content', CURRENT_USER)])
    renderBackupRestore()
    await createBackup('longpassphrase1', 'longpassphrase2')
    expect(mockDownloadExport).not.toHaveBeenCalled()
  })

  it('delivers a filename matching river-journal-backup-<YYYY-MM-DD>.rjbackup with an octet-stream blob type', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'some content', CURRENT_USER)])
    renderBackupRestore()
    await createBackup('longpassphrase1')
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalled())

    const { filename, blob } = lastDownloadCall()
    expect(filename).toMatch(/^river-journal-backup-\d{4}-\d{2}-\d{2}\.rjbackup$/)
    expect(blob.type).toBe('application/octet-stream')
  })

  it('still produces a valid backup for an empty local corpus (no entries) — never blocks or errors', async () => {
    renderBackupRestore() // no entries seeded
    await createBackup('longpassphrase1')
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalled())
    expect(screen.queryByTestId('backup-create-error')).toBeNull()
  })

  it('shows no spinner or loading indicator at any point while creating', async () => {
    seedStore(
      Array.from({ length: 40 }, (_, i) =>
        makeEntryAndFlow(dateFor(i), `entry body ${i}`, CURRENT_USER)
      )
    )
    renderBackupRestore()
    openCreateForm()
    fillCreatePassphrase('longpassphrase1')
    fireEvent.click(screen.getByTestId('backup-create-submit'))
    expectNoSpinner()
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalled())
    expectNoSpinner()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Restore flow: pick + passphrase, decrypt/validate, fail clean with zero
// writes on any error, prefix/shape rejected before AEAD, verbatim passphrase
// ═════════════════════════════════════════════════════════════════════════
describe('Restoring: pick a file + passphrase, decrypt/validate, fail clean with zero writes on any error', () => {
  it('a cancelled file pick (readBackupFile resolves null) leaves the surface idle — no passphrase prompt, no writes', async () => {
    renderBackupRestore()
    await startRestoreWithFile(null)
    expect(screen.queryByTestId('backup-restore-passphrase-input')).toBeNull()
  })

  it('the full pick -> passphrase -> decrypt -> restore workflow succeeds end-to-end on a fresh device', async () => {
    const { entry, flow } = makeEntryAndFlow('2026-04-10', 'a passage to restore', CURRENT_USER)
    seedStore([{ entry, flow }])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())
    expect(entries$[entry.id]!.get()).toBeTruthy()
    expect(flows$[flow.id]!.get()).toBeTruthy()
  })

  it('a wrong passphrase fails cleanly with a calm error and writes nothing', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'secret content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('correctPassphrase1')

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('wrongPassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(entries$.get()).toEqual({})
    expect(flows$.get()).toEqual({})
  })

  it('a tampered/garbage rj:backup:v1: ciphertext fails AEAD authentication cleanly and writes nothing', async () => {
    renderBackupRestore()
    await startRestoreWithFile(makeGarbageBackupEnvelope())
    await submitRestorePassphrase('anyPassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(entries$.get()).toEqual({})
    expect(flows$.get()).toEqual({})
  })

  it('a non-backup-format file (garbage/truncated, no rj: prefix at all) fails cleanly with zero writes', async () => {
    renderBackupRestore()
    await startRestoreWithFile('not even close to a backup file')
    await submitRestorePassphrase('anyPassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(entries$.get()).toEqual({})
    expect(flows$.get()).toEqual({})
  })

  it('rejects a well-formed non-backup payload (rj:e2e: flow-content prefix) on prefix/shape BEFORE attempting key derivation', async () => {
    renderBackupRestore()
    const foreignPayload = `rj:e2e:v1:${JSON.stringify({
      version: 1,
      algorithm: 'xchacha20poly1305',
      nonce: b64(randBytes(24)),
      ciphertext: b64(randBytes(16)),
    })}`
    kdfSpy.mockClear()
    await startRestoreWithFile(foreignPayload)
    await submitRestorePassphrase('anyPassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(kdfSpy).not.toHaveBeenCalled()
    expect(entries$.get()).toEqual({})
    expect(flows$.get()).toEqual({})
  })

  it('rejects a rj:backup:v1: envelope missing the required embedded salt field, before key derivation', async () => {
    renderBackupRestore()
    const missingSalt = `rj:backup:v1:${JSON.stringify({
      version: 1,
      algorithm: 'xchacha20poly1305',
      nonce: b64(randBytes(24)),
      ciphertext: b64(randBytes(16)),
    })}`
    kdfSpy.mockClear()
    await startRestoreWithFile(missingSalt)
    await submitRestorePassphrase('anyPassphrase1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(kdfSpy).not.toHaveBeenCalled()
  })

  it('feeds the passphrase to key derivation verbatim — a passphrase differing only by surrounding whitespace does NOT re-derive the same key', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('  leadingSpacePass1')

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('leadingSpacePass1') // trimmed variant

    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expect(entries$.get()).toEqual({})
  })

  it('restoring with the EXACT same passphrase used at create time succeeds (verbatim re-derivation works across devices)', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('  leadingSpacePass1')

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('  leadingSpacePass1')

    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Log-safety: passphrase, file contents, and raw errors never reach the logger
// ═════════════════════════════════════════════════════════════════════════
describe('Log-safety: passphrase, file contents, and raw errors never reach the logger', () => {
  it('a wrong-passphrase restore never logs the passphrase, the file contents, or entry body content', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'secret body content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('correctPassphrase1')

    freshDevice()
    renderBackupRestore()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('wrongPassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())

    const loggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : JSON.stringify(a)))
    for (const arg of loggedArgs) {
      expect(arg).not.toContain('wrongPassphrase1')
      expect(arg).not.toContain('correctPassphrase1')
      expect(arg).not.toContain(backupText)
      expect(arg).not.toContain('secret body content')
    }

    logSpy.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('a corrupt-file restore never logs the raw file contents or the raw error object', async () => {
    renderBackupRestore()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await startRestoreWithFile('garbage-file-contents-marker-not-a-backup')
    await submitRestorePassphrase('anyPassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())

    const loggedArgs = errorSpy.mock.calls
      .flat()
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : JSON.stringify(a)))
    for (const arg of loggedArgs) {
      expect(arg).not.toContain('garbage-file-contents-marker-not-a-backup')
    }

    errorSpy.mockRestore()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Additive restore: existing ids skipped, new ids inserted, counts summary
// ═════════════════════════════════════════════════════════════════════════
describe('A valid restore is strictly additive: existing ids skipped, new ids inserted, with a counts summary', () => {
  it('restoring a backup that fully overlaps the current local state skips everything and inserts nothing', async () => {
    const pairA = makeEntryAndFlow('2026-04-10', 'entry A', CURRENT_USER)
    const pairB = makeEntryAndFlow('2026-04-11', 'entry B', CURRENT_USER)
    seedStore([pairA, pairB])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    cleanup() // NOTE: deliberately NOT clearing entries$/flows$ — overlap case
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')

    const summary = await waitFor(() => screen.getByTestId('backup-restore-summary'))
    expect(summary.textContent).toMatch(/0/)
    expect(Object.keys(entries$.get() ?? {}).length).toBe(2)
    expect(Object.keys(flows$.get() ?? {}).length).toBe(2)
  })

  it('a fresh-device restore inserts everything and deep-equals the original corpus (ignoring lastModified)', async () => {
    const pairA = makeEntryAndFlow('2026-04-10', 'entry A content', CURRENT_USER)
    const pairB = makeEntryAndFlow('2026-04-11', 'entry B content', CURRENT_USER)
    seedStore([pairA, pairB])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')
    const originalEntries = entries$.get()
    const originalFlows = flows$.get()

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    const stripLastModified = (obj: Record<string, unknown> | undefined) =>
      Object.fromEntries(
        Object.entries(obj ?? {}).map(([id, v]) => [
          id,
          { ...(v as object), lastModified: undefined },
        ])
      )
    expect(stripLastModified(entries$.get())).toEqual(stripLastModified(originalEntries))
    expect(flows$.get()).toEqual(originalFlows)
  })

  it('an empty local corpus round-trips to a calm "0 restored, 0 skipped" summary, not an error', async () => {
    renderBackupRestore() // no entries
    const backupText = await fullRoundTripCreate('longpassphrase1')

    cleanup()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')

    const summary = await waitFor(() => screen.getByTestId('backup-restore-summary'))
    expect(summary.textContent).toMatch(/0/)
    expect(screen.queryByTestId('backup-restore-error')).toBeNull()
  })

  it('entries and flows are keyed independently: an existing entry with a NEW flow in the backup inserts only the new flow', async () => {
    const { entry, flow: existingFlow } = makeEntryAndFlow('2026-04-10', 'first flow', CURRENT_USER)
    const newFlow = extraFlow(
      entry.id,
      '2026-04-10',
      'second flow, written on another device',
      CURRENT_USER
    )
    seedStore([{ entry, flow: existingFlow }], [newFlow])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    // Simulate a device that already has the entry + first flow, but not the second.
    cleanup()
    entries$.set({ [entry.id]: entry })
    flows$.set({ [existingFlow.id]: existingFlow })
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    expect(flows$[newFlow.id]!.get()).toBeTruthy()
    expect(flows$[newFlow.id]!.get()?.dailyEntryId).toBe(entry.id)
    expect(Object.keys(entries$.get() ?? {}).length).toBe(1) // entry skipped, not duplicated
  })
})

// ═════════════════════════════════════════════════════════════════════════
// Ownership stays verbatim on restore — no adoption logic, standard sync gate
// ═════════════════════════════════════════════════════════════════════════
describe('Restored items keep ownership fields verbatim; no adoption logic; standard sync gate untouched', () => {
  it('a foreign-owned item restored on a different identity lands inert, with user_id/sync_excluded unchanged', async () => {
    store$.session.userId.set(OTHER_USER)
    const { entry, flow } = makeEntryAndFlow('2026-04-10', "a friend's backup content", OTHER_USER)
    seedStore([{ entry, flow }])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    freshDevice()
    store$.session.userId.set(CURRENT_USER) // a different identity now restores it
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    expect(entries$[entry.id]!.get()?.user_id).toBe(OTHER_USER)
    expect(flows$[flow.id]!.get()?.user_id).toBe(OTHER_USER)
  })

  it('restoring a foreign-owned item does not flip isSyncReady$ or auto-adopt it into sync', async () => {
    store$.session.userId.set(OTHER_USER)
    seedStore([makeEntryAndFlow('2026-04-10', 'foreign content', OTHER_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    freshDevice()
    store$.session.userId.set(CURRENT_USER)
    isSyncReady$.set(false)
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    expect(isSyncReady$.get()).toBe(false)
  })

  it('the full create -> restore round trip works identically with no account at all (anonymous, local-only)', async () => {
    store$.session.userId.set(null)
    seedStore([makeEntryAndFlow('2026-04-10', 'anonymous local content', null)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    freshDevice()
    store$.session.userId.set(null)
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    expect(Object.keys(entries$.get() ?? {}).length).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// No network, no spinners, calm states — across the full create + restore path
// ═════════════════════════════════════════════════════════════════════════
describe('No network requests, no spinners, calm states throughout create and restore', () => {
  it('a full create + restore cycle never touches the Supabase client or the global fetch', async () => {
    const fetchSpy = vi.fn()
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    seedStore([makeEntryAndFlow('2026-04-10', 'offline content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')

    freshDevice()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('longpassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-summary')).toBeTruthy())

    expect(rpcMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    globalThis.fetch = originalFetch
  })

  it('no spinner or loading indicator ever appears across create, restore success, or restore failure', async () => {
    seedStore([makeEntryAndFlow('2026-04-10', 'content', CURRENT_USER)])
    renderBackupRestore()
    const backupText = await fullRoundTripCreate('longpassphrase1')
    expectNoSpinner()

    cleanup()
    renderBackupRestore()
    await startRestoreWithFile(backupText)
    await submitRestorePassphrase('wrongPassphrase1')
    await waitFor(() => expect(screen.getByTestId('backup-restore-error')).toBeTruthy())
    expectNoSpinner()
  })
})
