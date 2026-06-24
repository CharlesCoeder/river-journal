/**
 * React Native download handler for journal export.
 * Writes the export to a file in the document directory and opens the native share sheet.
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

  const file = new File(Paths.document, filename)
  // overwrite so re-exporting the same filename doesn't throw on an existing file.
  file.create({ overwrite: true })
  file.write(bytes)

  await Sharing.shareAsync(file.uri, { mimeType: mimeType ?? blob.type })
}
