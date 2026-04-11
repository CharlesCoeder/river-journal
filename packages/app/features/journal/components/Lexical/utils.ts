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
    /* Outfit (default UI) */
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

    /* Newsreader (default journal) */
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

    /* Lato (classic UI) */
    @font-face {
      font-family: "Lato";
      src: url("${baseUrl}fonts/Lato/Lato-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "Lato-Bold";
      src: url("${baseUrl}fonts/Lato/Lato-Bold.ttf") format("truetype");
      font-weight: 700;
      font-style: normal;
    }

    /* Lora (classic journal) */
    @font-face {
      font-family: "Lora";
      src: url("${baseUrl}fonts/Lora/Lora-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "Lora";
      src: url("${baseUrl}fonts/Lora/Lora-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }
    @font-face {
      font-family: "Lora-Italic";
      src: url("${baseUrl}fonts/Lora/Lora-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }

    /* Inter (clean UI) */
    @font-face {
      font-family: "Inter";
      src: url("${baseUrl}fonts/Inter/Inter-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "Inter-Medium";
      src: url("${baseUrl}fonts/Inter/Inter-Medium.ttf") format("truetype");
      font-weight: 500;
      font-style: normal;
    }

    /* Source Serif 4 (clean journal) */
    @font-face {
      font-family: "SourceSerif4";
      src: url("${baseUrl}fonts/SourceSerif4/SourceSerif4-Regular.ttf") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "SourceSerif4";
      src: url("${baseUrl}fonts/SourceSerif4/SourceSerif4-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }
    @font-face {
      font-family: "SourceSerif4-Italic";
      src: url("${baseUrl}fonts/SourceSerif4/SourceSerif4-Italic.ttf") format("truetype");
      font-weight: 400;
      font-style: italic;
    }
    @font-face {
      font-family: "SourceSerif4-Medium";
      src: url("${baseUrl}fonts/SourceSerif4/SourceSerif4-Medium.ttf") format("truetype");
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
