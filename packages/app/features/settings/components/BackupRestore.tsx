import { useCallback, useState } from 'react'
import { Input, Text, YStack } from '@my/ui'
import { store$ } from 'app/state/store'
import { buildBackupPayload, parseAndValidateBackup } from 'app/utils/backupJournal'
import { encryptBackup, decryptBackup } from 'app/utils/backupCrypto'
import { restoreBackup, type RestoreResult } from 'app/state/backupRestore'
import { toExportBlob } from 'app/utils/exportBlob'
import { downloadExport } from 'app/utils/downloadExport'
import { readBackupFile } from 'app/utils/readBackupFile'
import { getAppVersion } from 'app/utils/appVersion'

type Mode =
  | 'home'
  | 'create'
  | 'create-done'
  | 'restore-passphrase'
  | 'restore-done'
  | 'restore-error'
  | 'working'

const MIN_PASSPHRASE_LENGTH = 8

/** Local (device-timezone) YYYY-MM-DD stamp for the backup filename. */
function backupDateStamp(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function readErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'restore_failed'
}

function Heading({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$journal"
      fontSize={20}
      color="$color"
    >
      {children}
    </Text>
  )
}

function EntryPoint({
  testID,
  label,
  onPress,
}: {
  testID: string
  label: string
  onPress: () => void
}) {
  return (
    <Text
      testID={testID}
      fontFamily="$journal"
      fontSize={18}
      color="$color"
      cursor="pointer"
      accessibilityRole="button"
      hoverStyle={{ opacity: 0.7 }}
      focusStyle={{ opacity: 0.7 }}
      onPress={onPress}
    >
      {label}
    </Text>
  )
}

function ActionText({
  testID,
  label,
  onPress,
}: {
  testID: string
  label: string
  onPress: () => void
}) {
  return (
    <Text
      testID={testID}
      fontFamily="$body"
      fontSize={11}
      letterSpacing={3}
      fontWeight="500"
      textTransform="uppercase"
      color="$color"
      borderBottomWidth={2}
      borderColor="$color10"
      paddingBottom={6}
      alignSelf="flex-start"
      cursor="pointer"
      accessibilityRole="button"
      hoverStyle={{ opacity: 0.7 }}
      focusStyle={{ opacity: 0.7 }}
      onPress={onPress}
    >
      {label}
    </Text>
  )
}

/**
 * Encrypted local backup: export the current identity's journal to a single
 * passphrase-encrypted `.rjbackup` file, and restore one additively. Fully
 * local — no network, no spinners, calm states. Available to every user
 * (including anonymous/local-only), since a no-account user is the whole reason
 * for the feature.
 */
export function BackupRestore() {
  const [mode, setMode] = useState<Mode>('home')

  const [createPassphrase, setCreatePassphrase] = useState('')
  const [createConfirm, setCreateConfirm] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const [restoreFileText, setRestoreFileText] = useState<string | null>(null)
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreSummary, setRestoreSummary] = useState<RestoreResult | null>(null)

  const openCreate = useCallback(() => {
    setCreatePassphrase('')
    setCreateConfirm('')
    setCreateError(null)
    setMode('create')
  }, [])

  const submitCreate = useCallback(async () => {
    if (createPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      setCreateError(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`)
      return
    }
    if (createPassphrase !== createConfirm) {
      setCreateError('The two passphrases do not match.')
      return
    }
    setCreateError(null)
    setMode('working')
    const startedAt = Date.now()
    try {
      const entries = store$.views.allEntriesSorted()
      const currentUserId = store$.session.userId.peek() ?? null
      const payload = buildBackupPayload(entries, currentUserId, getAppVersion())
      const ciphertext = await encryptBackup(JSON.stringify(payload), createPassphrase)
      const blob = toExportBlob(ciphertext, 'application/octet-stream')
      await downloadExport(blob, `river-journal-backup-${backupDateStamp()}.rjbackup`)
      // Metadata-only success log: counts + duration, never passphrase or content.
      console.log('[BackupRestore] backup created', {
        entries: payload.entryCount,
        flows: payload.flowCount,
        durationMs: Date.now() - startedAt,
      })
      setMode('create-done')
    } catch (error) {
      // Log a stable code only — never the passphrase, the payload, or the raw error.
      console.error('[BackupRestore] backup failed', { code: readErrorCode(error) })
      setCreateError('Something went wrong while preparing your backup.')
      setMode('create')
    }
  }, [createPassphrase, createConfirm])

  const openRestore = useCallback(async () => {
    const fileText = await readBackupFile()
    if (fileText == null) return
    setRestoreFileText(fileText)
    setRestorePassphrase('')
    setRestoreSummary(null)
    setMode('restore-passphrase')
  }, [])

  const submitRestore = useCallback(async () => {
    if (restoreFileText == null) return
    setMode('working')
    try {
      // Decrypt + validate BOTH complete before any store write, so a failure
      // aborts with zero partial import.
      const serialized = await decryptBackup(restoreFileText, restorePassphrase)
      const payload = parseAndValidateBackup(serialized)
      const result = restoreBackup(payload)
      setRestoreSummary(result)
      setMode('restore-done')
    } catch (error) {
      // Metadata-only: a stable error code, never the passphrase/file/raw error.
      console.error('[BackupRestore] restore failed', { code: readErrorCode(error) })
      setMode('restore-error')
    }
  }, [restoreFileText, restorePassphrase])

  return (
    <YStack gap="$4">
      <Heading>Encrypted Backup</Heading>
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$color8"
      >
        Save your whole journal as a single encrypted file, protected by a passphrase you choose.
        The backup is protected by that passphrase alone — if you lose it, the backup cannot be
        recovered.
      </Text>

      {mode === 'home' && (
        <YStack gap="$3">
          <EntryPoint
            testID="backup-create-open"
            label="Create encrypted backup"
            onPress={openCreate}
          />
          <EntryPoint
            testID="backup-restore-open"
            label="Restore from backup"
            onPress={openRestore}
          />
        </YStack>
      )}

      {mode === 'working' && (
        <Text
          testID="backup-working"
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          Working — this stays on your device…
        </Text>
      )}

      {mode === 'create' && (
        <YStack gap="$3">
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            Choose a passphrase (at least {MIN_PASSPHRASE_LENGTH} characters) and enter it twice.
          </Text>
          <Input
            testID="backup-create-passphrase-input"
            value={createPassphrase}
            onChangeText={setCreatePassphrase}
            secureTextEntry
            placeholder="Passphrase"
            fontFamily="$body"
            fontSize={13}
            borderColor="$color5"
            color="$color"
          />
          <Input
            testID="backup-create-passphrase-confirm-input"
            value={createConfirm}
            onChangeText={setCreateConfirm}
            secureTextEntry
            placeholder="Confirm passphrase"
            fontFamily="$body"
            fontSize={13}
            borderColor="$color5"
            color="$color"
          />
          {createError && (
            <Text
              testID="backup-create-error"
              fontFamily="$body"
              fontSize={12}
              color="$color"
            >
              {createError}
            </Text>
          )}
          <ActionText
            testID="backup-create-submit"
            label="Create backup"
            onPress={submitCreate}
          />
        </YStack>
      )}

      {mode === 'create-done' && (
        <YStack gap="$3">
          <Text
            testID="backup-create-summary"
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            Your encrypted backup is ready. Keep the file and your passphrase somewhere safe.
          </Text>
          <ActionText
            testID="backup-create-again"
            label="Create another"
            onPress={openCreate}
          />
        </YStack>
      )}

      {mode === 'restore-passphrase' && (
        <YStack gap="$3">
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            Enter the passphrase used to create this backup.
          </Text>
          <Input
            testID="backup-restore-passphrase-input"
            value={restorePassphrase}
            onChangeText={setRestorePassphrase}
            secureTextEntry
            placeholder="Passphrase"
            fontFamily="$body"
            fontSize={13}
            borderColor="$color5"
            color="$color"
          />
          <ActionText
            testID="backup-restore-submit"
            label="Restore"
            onPress={submitRestore}
          />
        </YStack>
      )}

      {mode === 'restore-done' && restoreSummary && (
        <YStack gap="$3">
          <Text
            testID="backup-restore-summary"
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            {restoreSummary.entriesRestored} entries restored, {restoreSummary.entriesSkipped}{' '}
            skipped (already present). {restoreSummary.flowsRestored} passages restored,{' '}
            {restoreSummary.flowsSkipped} skipped.
          </Text>
          <ActionText
            testID="backup-restore-done"
            label="Done"
            onPress={() => setMode('home')}
          />
        </YStack>
      )}

      {mode === 'restore-error' && (
        <YStack gap="$3">
          <Text
            testID="backup-restore-error"
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            That backup couldn't be restored. Check that you picked the right file and entered the
            correct passphrase, then try again. Nothing on your device was changed.
          </Text>
          <ActionText
            testID="backup-restore-retry"
            label="Try again"
            onPress={openRestore}
          />
        </YStack>
      )}
    </YStack>
  )
}
