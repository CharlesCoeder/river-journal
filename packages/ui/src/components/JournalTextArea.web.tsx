import { forwardRef } from 'react'
import { TextArea, styled } from '@my/ui'
import type { GetProps } from '@my/ui'

// 1. Create a base styled component for the text area.
// This is where you define the core, reusable styles and variants.
const StyledJournalArea = styled(TextArea, {
  name: 'JournalTextArea', // Giving it a name allows for component-specific sub-themes.
  flex: 1,

  // Default styles are defined here.
  fontSize: '$5',
  lineHeight: '$6',
  padding: '$3',
  borderRadius: '$4',
  borderWidth: 0,

  // Default theme-aware styles. These will automatically update with the theme.
  backgroundColor: '$backgroundHover',
  placeholderTextColor: '$color',

  // Focus state - remove borders and outline
  focusStyle: {
    borderWidth: 0,
    outlineWidth: 0,
    outlineStyle: 'none',
  },

  // Example of adding a responsive style directly to the definition.
  $gtSm: {
    minHeight: 120,
    fontSize: '$4',
    padding: '$4',
  },
  $gtMd: {
    minHeight: 150,
    fontSize: '$5',
    padding: '$4',
  },
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
    return <StyledJournalArea {...textAreaProps} ref={ref} minHeight={minHeight} />
  }
)
