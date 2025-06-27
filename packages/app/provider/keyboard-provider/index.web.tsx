import type React from 'react'

interface MobileKeyboardProviderProps {
  children: React.ReactNode
}

export function MobileKeyboardProvider({ children }: MobileKeyboardProviderProps) {
  // On web, we don't need the keyboard provider
  return <>{children}</>
}
