import type { ReactNode } from 'react'

/**
 * No-op on web — the browser viewport shrinks when the keyboard opens,
 * so position:fixed elements adjust automatically.
 */
export function KeyboardOffsetView({ children }: { children: ReactNode }) {
  return <>{children}</>
}
