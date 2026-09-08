import type { ReactNode } from 'react'

/**
 * Web/desktop: no hub gesture. The native implementation
 * (HubGestureHost.native.tsx) hosts the pan that drives the hub pager.
 */
export function HubGestureHost({ children }: { children: ReactNode }) {
  return <>{children}</>
}
