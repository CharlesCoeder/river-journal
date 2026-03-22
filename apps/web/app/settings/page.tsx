'use client'

import { SettingsScreen } from 'app/features/settings'
import { NavigationShell } from 'app/features/navigation/NavigationShell'

export default function SettingsPage() {
  return (
    <NavigationShell currentRoute="settings">
      <SettingsScreen />
    </NavigationShell>
  )
}
