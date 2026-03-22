'use client'

import { DayViewScreen } from 'app/features/day-view'
import { NavigationShell } from 'app/features/navigation/NavigationShell'

export default function DayViewPage() {
  return (
    <NavigationShell currentRoute="read">
      <DayViewScreen />
    </NavigationShell>
  )
}
