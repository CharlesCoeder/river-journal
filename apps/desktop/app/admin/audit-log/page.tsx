'use client'

import { AdminRouteGate } from 'app/features/moderation/AdminRouteGate'
import { AdminAuditLogScreen } from 'app/features/moderation/AdminAuditLogScreen'

export default function AdminAuditLogPage() {
  return (
    <AdminRouteGate>
      <AdminAuditLogScreen />
    </AdminRouteGate>
  )
}
