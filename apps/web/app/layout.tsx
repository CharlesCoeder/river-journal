// EAGER IMPORT — must run before NextTamaguiProvider/Provider mounts so
// setMutationDefaults() registers at module load. See:
// packages/app/state/collective/mutations.ts.
import 'app/state/collective/mutations'

import 'app/features/journal/components/Lexical/lexical-theme.css'
import '../public/tamagui.generated.css'
import '../public/hover-transitions.css'

import type { Metadata } from 'next'
import { NextTamaguiProvider } from 'app/provider/NextTamaguiProvider'
import { PersistenceGate } from 'app/provider/PersistenceGate'
import { SkipToContent } from 'app/features/navigation/SkipToContent'
import { KeyboardShortcuts } from 'app/features/navigation/KeyboardShortcuts'
import '../public/fonts/fonts.css'

export const metadata: Metadata = {
  title: 'River Journal',
  description: 'Let your thoughts flow',
  // Icon attribution: <a href="https://www.flaticon.com/free-icons/river" title="river icons">River icons created by Freepik - Flaticon</a>
  icons: '/favicon.ico',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // You can use `suppressHydrationWarning` to avoid the warning about mismatched content during hydration in dev mode
    <html lang="en" suppressHydrationWarning>
      <body>
        <SkipToContent />
        <NextTamaguiProvider>
          <PersistenceGate>
            <KeyboardShortcuts />
            <main id="main-content" tabIndex={-1} style={{ display: 'contents' }}>
              {children}
            </main>
          </PersistenceGate>
        </NextTamaguiProvider>
      </body>
    </html>
  )
}
