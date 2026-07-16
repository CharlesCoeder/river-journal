/**
 * React Native backup file-read seam.
 *
 * Lets the user pick a `.rjbackup` file via expo-document-picker, then reads its
 * contents as a string via expo-file-system. Resolves `null` when the pick is
 * cancelled. Only the already-encrypted file text is read into memory — no
 * plaintext is written to disk on the restore path.
 */
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'

export async function readBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  })

  if (result.canceled) return null

  const asset = result.assets?.[0]
  if (!asset) return null

  const file = new File(asset.uri)
  return file.text()
}
