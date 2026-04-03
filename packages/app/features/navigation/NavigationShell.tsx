import { YStack, XStack, Text, useMedia } from '@my/ui'
import { Home, PenLine, BookOpen, Settings, PanelLeftClose, PanelLeft } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { useState } from 'react'

type NavItem = {
  key: string
  label: string
  icon: typeof Home
  route: string
}

const navItems: NavItem[] = [
  { key: 'home', label: 'Home', icon: Home, route: '/' },
  { key: 'write', label: 'Write', icon: PenLine, route: '/journal' },
  { key: 'read', label: 'Read', icon: BookOpen, route: '/day-view' },
  { key: 'settings', label: 'Settings', icon: Settings, route: '/settings' },
]

type NavigationShellProps = {
  currentRoute: string
  children: React.ReactNode
}

export function NavigationShell({ currentRoute, children }: NavigationShellProps) {
  const media = useMedia()
  const showSidebar = media.md // 768px+
  const showLabels = media.lg // 1024px+

  if (showSidebar) {
    return <SidebarLayout currentRoute={currentRoute} showLabels={showLabels}>{children}</SidebarLayout>
  }

  return <BottomTabLayout currentRoute={currentRoute}>{children}</BottomTabLayout>
}

// — Sidebar (md+) —

function SidebarLayout({
  currentRoute,
  showLabels: defaultShowLabels,
  children,
}: {
  currentRoute: string
  showLabels: boolean
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const showLabels = defaultShowLabels && !collapsed
  const router = useRouter()

  return (
    <XStack flex={1} minHeight="100vh">
      {/* Sidebar */}
      <YStack
        width={showLabels ? 200 : 64}
        backgroundColor="$background"
        borderRightWidth={1}
        borderRightColor="$color4"
        paddingVertical="$4"
        paddingHorizontal={showLabels ? '$3' : '$0'}
        justifyContent="space-between"
        transition="quick"
      >
        <YStack gap="$1">
          {/* Collapse toggle */}
          {defaultShowLabels && (
            <XStack
              paddingHorizontal={showLabels ? '$3' : '$0'}
              paddingBottom="$4"
              justifyContent={showLabels ? 'flex-end' : 'center'}
            >
              <YStack
                cursor="pointer"
                onPress={() => setCollapsed(!collapsed)}
                opacity={0.4}
                hoverStyle={{ opacity: 0.8 }}
                padding="$2"
              >
                {collapsed ? (
                  <PanelLeft size={18} color="$color9" />
                ) : (
                  <PanelLeftClose size={18} color="$color9" />
                )}
              </YStack>
            </XStack>
          )}

          {navItems.map((item) => {
            const isActive = currentRoute === item.key
            const Icon = item.icon

            return (
              <XStack
                key={item.key}
                alignItems="center"
                gap="$3"
                paddingVertical="$3"
                paddingHorizontal="$3"
                borderRadius="$4"
                cursor="pointer"
                justifyContent={showLabels ? 'flex-start' : 'center'}
                backgroundColor={isActive ? '$color3' : 'transparent'}
                hoverStyle={{ backgroundColor: isActive ? '$color3' : '$color2' }}
                onPress={() => router.push(item.route)}
              >
                <Icon
                  size={20}
                  color={isActive ? '$color' : '$color9'}
                />
                {showLabels && (
                  <Text
                    fontSize="$3"
                    fontFamily="$body"
                    fontWeight={isActive ? '600' : '400'}
                    color={isActive ? '$color' : '$color9'}
                  >
                    {item.label}
                  </Text>
                )}
              </XStack>
            )
          })}
        </YStack>
      </YStack>

      {/* Content */}
      <YStack flex={1} backgroundColor="$background">
        {children}
      </YStack>
    </XStack>
  )
}

// — Bottom Tabs (below md) —

function BottomTabLayout({
  currentRoute,
  children,
}: {
  currentRoute: string
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <YStack flex={1} minHeight="100vh">
      {/* Content */}
      <YStack flex={1}>
        {children}
      </YStack>

      {/* Bottom tab bar */}
      <XStack
        backgroundColor="$background"
        borderTopWidth={1}
        borderTopColor="$color4"
        paddingVertical="$2"
        paddingBottom="$4"
        justifyContent="space-around"
        alignItems="center"
      >
        {navItems.map((item) => {
          const isActive = currentRoute === item.key
          const Icon = item.icon

          return (
            <YStack
              key={item.key}
              alignItems="center"
              gap="$1"
              cursor="pointer"
              onPress={() => router.push(item.route)}
              opacity={isActive ? 1 : 0.5}
              hoverStyle={{ opacity: isActive ? 1 : 0.8 }}
              paddingHorizontal="$3"
              paddingVertical="$1"
            >
              <Icon size={20} color={isActive ? '$color' : '$color9'} />
              <Text
                fontSize={11}
                fontFamily="$body"
                color={isActive ? '$color' : '$color9'}
                fontWeight={isActive ? '600' : '400'}
              >
                {item.label}
              </Text>
            </YStack>
          )
        })}
      </XStack>
    </YStack>
  )
}
