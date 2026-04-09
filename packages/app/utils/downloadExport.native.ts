/**
 * React Native download handler for journal export.
 * Writes ZIP to temp file and opens the native share sheet.
 */
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { encode } from 'base64-arraybuffer'

export async function downloadExport(
  blob: Blob,
  filename = 'river-journal-export.zip',
  mimeType?: string
): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer()
  const base64 = encode(arrayBuffer)

  const fileUri = FileSystem.documentDirectory + filename
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })
  await Sharing.shareAsync(fileUri, { mimeType: mimeType ?? blob.type })
}
