// @vitest-environment happy-dom
/**
 * PrivacyCenterScreen.backupRestore.e2e.test.tsx — TDD red-phase E2E tests for
 * the Privacy Center PLACEMENT of the encrypted-backup section: the new
 * staggered section actually reveals (the story requires bumping
 * `SECTION_COUNT` from 5 to 6 so it isn't silently hidden forever), it sits
 * alongside — without disturbing — the existing Privacy Modes / Postures /
 * Access / Retention / Your Data sections, and its entry points are available
 * to an anonymous (no-account) session, exactly like the authenticated case
 * (never auth-gated, since this is the no-account user's whole reason for the
 * feature).
 *
 * This is a sibling to the existing `PrivacyCenterScreen.test.tsx` (which
 * stubs every settings child component and checks placement/wiring only) —
 * mirroring the `AppLockSettings.e2e.test.tsx` / `SettingsScreen.appLock.e2e.test.tsx`
 * split: the encrypted-backup component's own full user workflow (create/
 * restore, crypto, additive merge, failure handling) is exercised in the
 * sibling `BackupRestore.e2e.test.tsx`; this file mounts the REAL
 * `BackupRestore` inside the REAL `PrivacyCenterScreen` only to verify
 * PLACEMENT, not to re-drive the workflow.
 *
 * Red-phase contract: `PrivacyCenterScreen.tsx` does not yet render a
 * Backup/Restore section (`SECTION_COUNT` is still 5) and
 * `features/settings/components/BackupRestore.tsx` does not exist yet — this
 * file fails at the top-level `import` until both are added.
 *
 * ASSUMED CONTRACT: same entry-point testIDs (`backup-create-open`,
 * `backup-restore-open`) and honesty-copy proxy (/cannot be recovered/i) as
 * `BackupRestore.e2e.test.tsx` — see that file's docblock for the full list.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { rpcMock, fromMock, mockDownloadExport, mockReadBackupFile } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  mockDownloadExport: vi.fn().mockResolvedValue(undefined),
  mockReadBackupFile: vi.fn(),
}))

// ─── True externals — same seams as BackupRestore.e2e.test.tsx. The real
// scrypt KDF is left untouched here: no create/restore submission happens in
// this placement-only file, so its cost never gets paid. ────────────────────
vi.mock('app/utils/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))
vi.mock('app/utils/downloadExport', () => ({
  downloadExport: (...args: unknown[]) => mockDownloadExport(...args),
}))
vi.mock('app/utils/readBackupFile', () => ({
  readBackupFile: () => mockReadBackupFile(),
}))

// ─── app/state/encryptionSetup — mocked exactly like the existing
// PrivacyCenterScreen.test.tsx (its own dependency chain — userEncryption,
// webKeyStore, encryptionKeyStore — is unrelated to backup placement).
// Built via importActual so the REAL (unmocked) use$ in this file still
// subscribes correctly. ──────────────────────────────────────────────────────
vi.mock('app/state/encryptionSetup', async () => {
  const { observable } =
    await vi.importActual<typeof import('@legendapp/state')>('@legendapp/state')
  return {
    encryptionSetup$: {
      currentMode: observable<string | null>(null),
    },
  }
})

vi.mock('solito/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

// ─── @my/ui — passthrough preserving testID/onPress, plus a minimal Input. ──
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

  const Input = ({ testID, value, onChangeText }: any) =>
    ReactModule.createElement('input', {
      ...(testID ? { 'data-testid': testID } : {}),
      value,
      onChange: (e: any) => onChangeText?.(e.target.value),
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

// ─── Pre-existing heavy siblings — stubbed exactly as PrivacyCenterScreen.test.tsx
// does: their own dedicated suites cover their workflows; here only PLACEMENT
// relative to the new backup section matters. ───────────────────────────────
vi.mock('../components/ExportJournal', () => ({
  ExportJournal: () => React.createElement('div', { 'data-testid': 'export-journal-mock' }),
}))
vi.mock('../components/ExportCollectivePosts', () => ({
  ExportCollectivePosts: () =>
    React.createElement('div', { 'data-testid': 'export-collective-posts-mock' }),
}))
vi.mock('../components/DeleteAccountFlow', () => ({
  DeleteAccountFlow: () =>
    React.createElement('div', { 'data-testid': 'delete-account-flow-mock' }),
}))
vi.mock('app/features/disclosure/ThreePostureDisclosure', () => ({
  ThreePostureDisclosure: () => null,
}))

// ─── Import under test — real screen, real BackupRestore (NOT stubbed), real
// store$/entries$/flows$. ────────────────────────────────────────────────────
import { PrivacyCenterScreen } from '../PrivacyCenterScreen'
import { store$ } from 'app/state/store'
import { entries$ } from 'app/state/entries'
import { flows$ } from 'app/state/flows'

beforeEach(() => {
  entries$.set({})
  flows$.set({})
  store$.session.userId.set(null)
  store$.session.isAuthenticated.set(false)
  mockDownloadExport.mockClear()
  mockReadBackupFile.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('The encrypted-backup section is a new staggered Privacy Center section, available without auth', () => {
  it('reveals a Create-backup and a Restore-backup entry point for an anonymous session, once the stagger settles', async () => {
    render(React.createElement(PrivacyCenterScreen))
    expect(await screen.findByTestId('backup-create-open')).toBeTruthy()
    expect(await screen.findByTestId('backup-restore-open')).toBeTruthy()
  })

  it('states the passphrase-only, unrecoverable-without-it warning in the new section', async () => {
    render(React.createElement(PrivacyCenterScreen))
    expect(await screen.findByText(/cannot be recovered/i)).toBeTruthy()
  })

  it('does not disturb the existing Privacy Modes / Access / Retention / Your Data sections — they still render alongside the new one', async () => {
    render(React.createElement(PrivacyCenterScreen))

    expect(await screen.findByTestId('backup-create-open')).toBeTruthy()
    expect((await screen.findAllByText('Strict Privacy Mode')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('What We Can & Cannot Access')).toBeTruthy()
    expect(screen.getByText('Data Retention & Deletion')).toBeTruthy()
    expect(screen.getByTestId('export-journal-mock')).toBeTruthy()
  })

  it('mounts the entry points for an authenticated session too — the feature is available regardless of auth, not merely anonymous', async () => {
    store$.session.userId.set('user-1')
    store$.session.isAuthenticated.set(true)
    render(React.createElement(PrivacyCenterScreen))
    expect(await screen.findByTestId('backup-create-open')).toBeTruthy()
    expect(await screen.findByTestId('backup-restore-open')).toBeTruthy()
  })
})
