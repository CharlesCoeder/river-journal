import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import { createBaseLexicalConfig } from './lexical-config'

/**
 * Injects CSS font-face declarations for fonts available in DOM components
 * Uses process.env.EXPO_BASE_URL to reference public assets
 * Returns a cleanup function to remove the injected styles
 */
export const injectFontCSS = (): (() => void) => {
  const styleId = 'expo-dom-fonts'

  // Check if styles already injected
  const existingStyle = document.getElementById(styleId)
  if (existingStyle) {
    // Return a cleanup function that removes the existing style
    return () => {
      existingStyle.remove()
    }
  }

  const baseUrl = process.env.EXPO_BASE_URL || ''

  const fontCSS = `
    @font-face {
      font-family: "SourceSans3";
      src: url("${baseUrl}fonts/SourceSans3/SourceSans3-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    
    @font-face {
      font-family: "SourceSans3";
      src: url("${baseUrl}fonts/SourceSans3/SourceSans3-Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
    }
    
    @font-face {
      font-family: "SourceSans3";
      src: url("${baseUrl}fonts/SourceSans3/SourceSans3-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }
    
    @font-face {
      font-family: "SourceSans3";
      src: url("${baseUrl}fonts/SourceSans3/SourceSans3-BoldItalic.ttf") format("truetype");
      font-weight: 700;
      font-style: italic;
    }
    
    @font-face {
      font-family: "PatrickHand";
      src: url("${baseUrl}fonts/PatrickHand.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
  `

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = fontCSS
  document.head.appendChild(style)

  // Return cleanup function
  return () => {
    const injectedStyle = document.getElementById(styleId)
    if (injectedStyle) {
      injectedStyle.remove()
    }
  }
}

/**
 * Creates mobile-specific Lexical config without CSS class theme mappings
 * since we use inline styles with dynamic theme values
 */
export const createMobileLexicalConfig = (): InitialConfigType => {
  const baseConfig = createBaseLexicalConfig()
  return {
    ...baseConfig,
    // Remove theme class mappings for mobile - we'll use inline styles instead
    theme: {},
  }
}
