/**
 * Web/Desktop download handler for journal export.
 * Uses a hidden anchor element to trigger browser download.
 * Desktop (Tauri) runs in a webview, so this handler works there too.
 */
export async function downloadExport(blob: Blob, filename = 'river-journal-export.zip'): Promise<void> {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
