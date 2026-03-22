'use client'

import { HomeScreen } from 'app/features/home/HomeScreen'
import { NavigationShell } from 'app/features/navigation/NavigationShell'

export default function Page() {
  return (
    <NavigationShell currentRoute="home">
      <HomeScreen />
    </NavigationShell>
  )
}
