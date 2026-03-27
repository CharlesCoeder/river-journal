import { Tabs, useRouter } from 'expo-router'
import { Home, PenLine, BookOpen, Settings } from '@tamagui/lucide-icons'
import { useTheme } from '@my/ui'

export default function TabLayout() {
  const theme = useTheme()
  const router = useRouter()

  const activeColor = theme.color?.val ?? '#000'
  const inactiveColor = theme.color9?.val ?? '#999'
  const backgroundColor = theme.background?.val ?? '#fff'
  const borderColor = theme.color4?.val ?? '#eee'

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: {
          backgroundColor,
          borderTopColor: borderColor,
          borderTopWidth: 1,
          paddingBottom: 2,
          height: 50,
        },
        tabBarLabelStyle: {
          fontFamily: 'Outfit',
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="write"
        options={{
          title: 'Write',
          tabBarIcon: ({ color, size }) => <PenLine size={size} color={color} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault()
            router.push('/journal')
          },
        }}
      />
      <Tabs.Screen
        name="day-view"
        options={{
          title: 'Read',
          tabBarIcon: ({ color, size }) => <BookOpen size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  )
}
