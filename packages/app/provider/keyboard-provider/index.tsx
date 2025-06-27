import type React from 'react'
import { KeyboardProvider } from 'react-native-keyboard-controller'

interface MobileKeyboardProviderProps {
  children: React.ReactNode
}

export function MobileKeyboardProvider({ children }: MobileKeyboardProviderProps) {
  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      {children}
    </KeyboardProvider>
  )
}
