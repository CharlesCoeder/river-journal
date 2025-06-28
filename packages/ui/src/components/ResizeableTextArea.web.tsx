import { TextArea } from '@my/ui'
import type { TextAreaProps } from '@my/ui'

export interface ResizeableTextAreaProps extends TextAreaProps {
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

export function ResizeableTextArea({
  keyboardPadding, // ignored on web
  minHeight = 150,
  ...textAreaProps
}: ResizeableTextAreaProps) {
  return <TextArea {...textAreaProps} minHeight={minHeight} />
}
