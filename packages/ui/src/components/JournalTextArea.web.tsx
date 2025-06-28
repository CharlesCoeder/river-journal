import { TextArea } from '@my/ui'
import type { TextAreaProps } from '@my/ui'

export interface JournalTextAreaProps extends TextAreaProps {
  /**
   * Extra padding to maintain above keyboard when it appears
   * (ignored on web)
   */
  keyboardPadding?: number
  /**
   * Minimum height constraint for the text area
   */
  minHeight?: number
}

export function JournalTextArea({
  keyboardPadding, // ignored on web
  minHeight = 150,
  ...textAreaProps
}: JournalTextAreaProps) {
  return <TextArea {...textAreaProps} minHeight={minHeight} />
}
