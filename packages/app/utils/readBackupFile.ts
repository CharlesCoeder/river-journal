/**
 * Web/Desktop backup file-read seam.
 *
 * Opens a hidden `<input type="file">`, lets the user pick a `.rjbackup` file,
 * and resolves its text contents (or `null` if the pick is cancelled). Desktop
 * (Tauri) runs in a webview, so this DOM implementation works there too. The
 * native counterpart (`readBackupFile.native.ts`) uses expo-document-picker.
 *
 * Only the already-encrypted file text is read into memory — no plaintext is
 * ever written to disk on the restore path.
 */
export function readBackupFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.rjbackup,application/octet-stream'
    input.style.display = 'none'

    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      if (input.parentNode) input.parentNode.removeChild(input)
      resolve(value)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      file
        .text()
        .then((text) => finish(text))
        .catch(() => finish(null))
    })
    // Fired when the picker is dismissed without a selection.
    input.addEventListener('cancel', () => finish(null))

    document.body.appendChild(input)
    input.click()
  })
}
