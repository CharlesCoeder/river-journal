import { forwardRef } from 'react'
import { TextArea, styled } from '@my/ui'
import type { GetProps } from '@my/ui'

// 1. Create a base styled component for the text area.
// This is where you define the core, reusable styles and variants.
const StyledJournalArea = styled(TextArea, {
  name: 'JournalTextArea',
  flex: 1,
  // Default styles are defined here.
  fontSize: '5 sm:4 md:5',
  lineHeight: '6',
  padding: '3 sm:4 md:4',
  borderRadius: '4',
  // Focus state - remove borders and outline
  borderWidth: '0px focus:0px',
  // Default theme-aware styles. These will automatically update with the theme.
  backgroundColor: 'background-hover',
  placeholderTextColor: 'color',
  outlineWidth: 'focus:0px',
  outlineStyle: 'focus:none',
  // Example of adding a responsive style directly to the definition.
  minHeight: 'sm:120px md:150px',
})

// 2. Define the props for the final component.
// GetProps extracts all props from the styled component, including its variants.
type JournalTextAreaProps = GetProps<typeof StyledJournalArea> & {
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

// 3. Create the final component for web - much simpler than mobile version
// We use forwardRef to allow passing a ref to the underlying TextArea.
export const JournalTextArea = forwardRef<any, JournalTextAreaProps>(
  ({ keyboardPadding, minHeight = 150, ...textAreaProps }, ref) => {
    return (
      <StyledJournalArea
        {...textAreaProps}
        ref={ref}
        minHeight={minHeight}
      />
    )
  }
)
