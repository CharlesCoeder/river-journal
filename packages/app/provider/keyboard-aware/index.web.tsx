import type React from 'react'

interface KeyboardAwareContainerProps {
  children: React.ReactNode
  flex?: number
}

export function KeyboardAwareContainer({ children }: KeyboardAwareContainerProps) {
  // On web, we don't need keyboard avoidance, just pass through the children
  return <>{children}</>
}
