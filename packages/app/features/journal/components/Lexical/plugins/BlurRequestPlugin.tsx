/**
 * BlurRequestPlugin — blurs the editor whenever the `request` counter changes
 * (not on mount).
 *
 * Blurring the contenteditable is what dismisses the soft keyboard inside a
 * WebView — RN's Keyboard.dismiss() only knows about native TextInputs. Shared
 * by the journal editor and the Collective composer.
 */

import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

export function BlurRequestPlugin({ request }: { request: number }): null {
  const [editor] = useLexicalComposerContext()
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    editor.blur()
  }, [editor, request])
  return null
}
