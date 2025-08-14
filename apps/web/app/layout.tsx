if (process.env.NODE_ENV === 'production') {
  require('../public/tamagui.css')
}
import 'app/features/journal/lexical-theme.css'

import type { Metadata } from 'next'
import { NextTamaguiProvider } from 'app/provider/NextTamaguiProvider'
import { PersistenceGate } from 'app/provider/PersistenceGate'

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
        <PersistenceGate>
          <NextTamaguiProvider>{children}</NextTamaguiProvider>
        </PersistenceGate>
      </body>
    </html>
  )
}
