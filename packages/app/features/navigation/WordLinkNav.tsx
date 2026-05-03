import { useRef } from 'react'
import { View, XStack, Text, useMedia, useReducedMotion } from '@my/ui'
import { useRouter, usePathname } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { signOut } from 'app/utils'

// ---------------------------------------------------------------------------
// Locked word-link item list — mirrors MENU_ITEMS but without icons.
// Both 'account' and 'log-in-out' target /auth (web/desktop have no /account).
// ---------------------------------------------------------------------------

type WordLinkItem = {
  readonly key: string
  readonly label: string
  readonly route: string
}

export const WORD_LINK_ITEMS = Object.freeze([
  { key: 'past-entries', label: 'Past Entries', route: '/day-view' },
  { key: 'collective', label: 'Collective', route: '/collective' },
  { key: 'streak-profile', label: 'Streak/Profile', route: '/streak' },
  { key: 'preferences', label: 'Preferences', route: '/settings' },
  { key: 'account', label: 'Account', route: '/auth' },
  { key: 'log-in-out', label: 'Log in/out', route: '/auth' },
] as const satisfies ReadonlyArray<WordLinkItem>)

// ---------------------------------------------------------------------------
// WordLinkNav
// ---------------------------------------------------------------------------

interface WordLinkNavProps {
  /** 'home' ≈ $3 / 14px; 'browse' ≈ $2 / 12px */
  variant: 'home' | 'browse'
  /** Override current route for testing */
  currentRoute?: string
}

export function WordLinkNav({ variant, currentRoute }: WordLinkNavProps) {
  const router = useRouter()
  const pathnameFromHook = usePathname()
  const pathname = currentRoute ?? pathnameFromHook
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const reduceMotion = useReducedMotion()
  const media = useMedia()

  // Press-flood guard — one latch for the whole nav surface
  const isNavigatingRef = useRef(false)

  // Suppress below laptop-width viewports (mobile/tablet).
  // Tamagui v5 `lg` breakpoint = minWidth: 1024px, matching the "laptop or larger" threshold.
  // `gtMd` does not exist in Tamagui v5 — use `media.lg` directly.
  const isWide = media.lg ?? false
  if (!isWide) return null

  const fontSize = variant === 'home' ? '$3' : '$2'

  // Normalize pathname for comparison (strip trailing slash)
  function normalizeRoute(route: string): string {
    return route === '/' ? '/' : route.replace(/\/$/, '')
  }

  const normalizedPathname = normalizeRoute(pathname ?? '/')

  function isActive(item: (typeof WORD_LINK_ITEMS)[number]): boolean {
    // For auth items, apply auth-state logic: only mark the contextually-correct item active
    if (item.key === 'account') {
      // Account is active only when on /auth AND authenticated
      return normalizedPathname === '/auth' && isAuthenticated
    }
    if (item.key === 'log-in-out') {
      // Log in/out is active only when on /auth AND not authenticated
      return normalizedPathname === '/auth' && !isAuthenticated
    }
    return normalizeRoute(item.route) === normalizedPathname
  }

  async function handlePress(
    e: { preventDefault?: () => void; metaKey?: boolean; ctrlKey?: boolean; button?: number } | undefined,
    item: (typeof WORD_LINK_ITEMS)[number]
  ) {
    // Suppress modifier clicks — let browser handle "open in new tab" natively
    if (e?.metaKey || e?.ctrlKey || (e?.button != null && e.button !== 0)) return

    // Call preventDefault on normal click to suppress anchor full-page navigation
    e?.preventDefault?.()

    // Press-flood guard
    if (isNavigatingRef.current) return
    isNavigatingRef.current = true

    setTimeout(() => {
      isNavigatingRef.current = false
    }, 400)

    // No-op if already on the target route
    if (item.key !== 'log-in-out' && normalizeRoute(item.route) === normalizedPathname) {
      isNavigatingRef.current = false
      return
    }

    if (item.key === 'log-in-out') {
      if (isAuthenticated) {
        try {
          await signOut()
        } catch (err) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[WordLinkNav] signOut failed:', err)
          }
          isNavigatingRef.current = false
          return
        }
      }
      router.push('/auth')
    } else {
      router.push(item.route)
    }
  }

  return (
    <View
      tag="nav"
      aria-label="Primary navigation"
      role="navigation"
    >
      <XStack gap="$4">
        {WORD_LINK_ITEMS.map((item) => {
          const active = isActive(item)

          // Resolve visible label (separate from const label for auth items)
          const resolvedLabel: string =
            item.key === 'log-in-out'
              ? (isAuthenticated ? 'Log out' : 'Log in')
              : item.label

          const color = active ? '$color' : '$color8'

          return (
            <Text
              key={item.key}
              tag="a"
              href={item.route}
              aria-current={active ? 'page' : undefined}
              data-active={active ? 'true' : undefined}
              cursor="pointer"
              fontFamily="$body"
              fontSize={fontSize}
              letterSpacing={0.5}
              color={color}
              hoverStyle={reduceMotion ? undefined : { color: '$color' }}
              focusVisibleStyle={{ outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$color' }}
              textDecorationLine="none"
              onClick={(e: any) => handlePress(e, item)}
            >
              {resolvedLabel}
            </Text>
          )
        })}
      </XStack>
    </View>
  )
}

export default WordLinkNav
