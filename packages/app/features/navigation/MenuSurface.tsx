import { useEffect, useRef, useState } from 'react'
import { View, XStack, YStack, Text } from '@my/ui'
import { BookOpen, Users, Flame, Settings, User, LogIn, LogOut } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { signOut } from 'app/utils'
import { useReducedMotion } from '@my/ui'

// ---------------------------------------------------------------------------
// Locked menu item list — frozen so runtime mutation throws / TS compile-errors
// ---------------------------------------------------------------------------

type MenuItem = {
  readonly key: string
  readonly label: string
  readonly icon: React.ComponentType<{ size?: number; color?: string }>
  readonly route: string
}

export const MENU_ITEMS = Object.freeze([
  { key: 'past-entries', label: 'Past Entries', icon: BookOpen, route: '/day-view' },
  { key: 'collective', label: 'Collective', icon: Users, route: '/collective' },
  { key: 'streak-profile', label: 'Streak/Profile', icon: Flame, route: '/streak' },
  { key: 'preferences', label: 'Preferences', icon: Settings, route: '/settings' },
  { key: 'account', label: 'Account', icon: User, route: '/account' },
  { key: 'log-in-out', label: 'Log in/out', icon: LogIn, route: '/auth' },
] as const satisfies ReadonlyArray<MenuItem>)

// ---------------------------------------------------------------------------
// MenuSurface
// ---------------------------------------------------------------------------

export function MenuSurface() {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const isAuthenticated = use$(store$.session.isAuthenticated)

  // Stagger reveal: index of the last item revealed (-1 = nothing shown yet)
  const [revealedIndex, setRevealedIndex] = useState<number>(-1)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Press-flood guard — one latch for the whole surface
  const isNavigatingRef = useRef(false)

  // Kick off stagger animation on mount
  useEffect(() => {
    if (reduceMotion) {
      setRevealedIndex(MENU_ITEMS.length - 1)
      return
    }

    const timers = MENU_ITEMS.map((_, index) =>
      setTimeout(() => {
        setRevealedIndex(index)
      }, index * 100)
    )
    timeoutsRef.current = timers

    return () => {
      for (const t of timers) clearTimeout(t)
      timeoutsRef.current = []
    }
  }, [reduceMotion])

  // Clear all pending stagger timeouts and snap to full-reveal immediately
  function flushStagger() {
    for (const t of timeoutsRef.current) clearTimeout(t)
    timeoutsRef.current = []
    setRevealedIndex(MENU_ITEMS.length - 1)
  }

  function handlePress(route: string, isAuth?: boolean) {
    if (isNavigatingRef.current) return
    isNavigatingRef.current = true

    // Short-circuit any in-progress stagger so user never sees a half-revealed list
    flushStagger()

    if (!router) {
      if (__DEV__) {
        console.warn('[MenuSurface] router is undefined — check Solito provider tree')
      }
      isNavigatingRef.current = false
      return
    }

    // Fire navigation
    if (route !== '/auth') {
      router.push(route)
    } else {
      // Log in/out item
      void handleAuthPress(isAuth ?? false)
    }

    // Clear latch after 400ms cooldown
    setTimeout(() => {
      isNavigatingRef.current = false
    }, 400)
  }

  async function handleAuthPress(wasAuthed: boolean) {
    if (wasAuthed) {
      try {
        await signOut()
      } catch (err) {
        if (__DEV__) {
          console.warn('[MenuSurface] signOut failed:', err)
        }
        isNavigatingRef.current = false
        return
      }
    }
    router.push('/auth')
  }

  return (
    <View
      tag="ul"
      accessibilityRole="menu"
      accessibilityLabel="Main menu"
      aria-label="Main menu"
      role="menu"
      paddingVertical="$4"
      paddingHorizontal="$6"
      gap="$2"
    >
      {MENU_ITEMS.map((item, index) => {
        const isVisible = index <= revealedIndex
        const isAuthItem = item.route === '/auth'
        const label = isAuthItem
          ? isAuthenticated
            ? 'Log out'
            : 'Log in'
          : item.label
        const Icon = isAuthItem
          ? isAuthenticated
            ? LogOut
            : LogIn
          : item.icon

        return (
          <MenuRow
            key={item.key}
            label={label}
            icon={<Icon size={20} color="$color9" />}
            isVisible={isVisible}
            reduceMotion={reduceMotion}
            onPress={() => handlePress(item.route, isAuthenticated)}
          />
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------
// MenuRow — individual menu item with underline-on-press feedback
// ---------------------------------------------------------------------------

interface MenuRowProps {
  label: string
  icon: React.ReactNode
  isVisible: boolean
  reduceMotion: boolean
  onPress: () => void
}

function MenuRow({ label, icon, isVisible, reduceMotion, onPress }: MenuRowProps) {
  const [isPressed, setIsPressed] = useState(false)

  const lineWidth = isPressed ? 24 : 16

  // Stagger visibility state
  const opacity = isVisible ? 1 : 0
  const translateY = isVisible ? 0 : -8

  return (
    <View
      tag="li"
      accessibilityRole="menuitem"
      role="menuitem"
      data-hidden={!isVisible ? 'true' : undefined}
      minHeight={44}
      animation={!reduceMotion ? 'designEnter' : undefined}
      opacity={opacity}
      transform={[{ translateY }]}
    >
      <View
        tag="button"
        accessibilityRole="button"
        cursor="pointer"
        minHeight={44}
        paddingVertical="$3"
        paddingHorizontal="$2"
        alignItems="center"
        flexDirection="row"
        gap="$3"
        backgroundColor="transparent"
        borderWidth={0}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        onPress={onPress}
      >
        {icon}
        <YStack>
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$color"
            letterSpacing={0.5}
            textTransform="uppercase"
          >
            {label}
          </Text>
          {/* Expanding underline */}
          <View
            width={lineWidth}
            height={1}
            backgroundColor="$color"
            transition={reduceMotion ? undefined : 'smoothCollapse'}
          />
        </YStack>
      </View>
    </View>
  )
}

export default MenuSurface
