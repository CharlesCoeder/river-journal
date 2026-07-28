'use client'

import { AdminRouteGate } from 'app/features/moderation/AdminRouteGate'
import ModerationQueueScreen from 'app/features/moderation/ModerationQueueScreen'

export default function AdminModerationPage() {
  return (
    <AdminRouteGate>
      <ModerationQueueScreen />
    </AdminRouteGate>
  )
}
