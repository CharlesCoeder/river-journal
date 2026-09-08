import type { HubPagerProps } from './hubPagerContext'

export type { HubPagerProps } from './hubPagerContext'

/**
 * Web/desktop: there is no pager — the spokes are routes and home is home.
 * The native implementation (HubPager.native.tsx) mounts the spokes beside
 * home so a slide moves the real screens.
 */
export function HubPager({ home }: HubPagerProps) {
  return <>{home}</>
}
