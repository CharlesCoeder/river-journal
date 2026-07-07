/**
 * React Native download handler for journal export.
 * Writes the export to a file in the app's CACHE directory and opens the native
 * share sheet, then deletes the file once the sheet closes. Cache (unlike the
 * document directory) is excluded from iCloud/iTunes device backups, so a
 * plaintext journal copy is never swept into a cloud backup — and the file is
 * removed as soon as the user is done sharing, so nothing lingers on disk.
 */
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { exportBlobToBytes } from 'app/utils/exportBlob'

export async function downloadExport(
  blob: Blob,
  filename = 'river-journal-export.zip',
  mimeType?: string
): Promise<void> {
  const bytes = await exportBlobToBytes(blob)

  // Cache directory (NOT Paths.document): backup-excluded and system-purgeable.
  const file = new File(Paths.cache, filename)
  // overwrite so re-exporting the same filename doesn't throw on an existing file.
  file.create({ overwrite: true })
  file.write(bytes)

  try {
    // shareAsync resolves when the share sheet is dismissed (shared or cancelled).
    await Sharing.shareAsync(file.uri, { mimeType: mimeType ?? blob.type })
  } finally {
    // Delete the plaintext copy once the share sheet has closed. Best-effort:
    // a failed cleanup must not surface as an export error (cache is purgeable).
    try {
      if (file.exists) file.delete()
    } catch {
      // Leaving a stray temp file in a backup-excluded, purgeable cache is harmless.
    }
  }
}
