import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import { createBaseLexicalConfig } from './lexical-config'

/**
 * Injects CSS font-face declarations for fonts available in DOM components
 * Uses process.env.EXPO_BASE_URL to reference public assets
 * Returns a cleanup function to remove the injected styles
 */
export const injectFontCSS = (): (() => void) => {
  const styleId = 'expo-dom-fonts'

  const existingStyle = document.getElementById(styleId)
  if (existingStyle) {
    return () => {
      existingStyle.remove()
    }
  }

  const baseUrl = process.env.EXPO_BASE_URL || ''

  const fontCSS = `
    @font-face {
      font-family: "Outfit";
      src: url("${baseUrl}fonts/Outfit/Outfit-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }

    @font-face {
      font-family: "Outfit-Medium";
      src: url("${baseUrl}fonts/Outfit/Outfit-Medium.ttf") format("truetype");
      font-weight: 500;
      font-style: normal;
    }

    @font-face {
      font-family: "Newsreader";
      src: url("${baseUrl}fonts/Newsreader/Newsreader-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }

    @font-face {
      font-family: "Newsreader-Italic";
      src: url("${baseUrl}fonts/Newsreader/Newsreader-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }

    @font-face {
      font-family: "Newsreader-Medium";
      src: url("${baseUrl}fonts/Newsreader/Newsreader-Medium.ttf") format("truetype");
      font-weight: 500;
      font-style: normal;
    }
  `

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = fontCSS
  document.head.appendChild(style)

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
    theme: {},
  }
}
