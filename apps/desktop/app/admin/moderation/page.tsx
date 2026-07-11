'use client'

import { AdminRouteGate } from 'app/features/moderation/AdminRouteGate'
import { AdminModerationScreen } from 'app/features/moderation/AdminModerationScreen'

export default function AdminModerationPage() {
  return (
    <AdminRouteGate>
      <AdminModerationScreen />
    </AdminRouteGate>
  )
}
