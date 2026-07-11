'use client'

import { AdminRouteGate } from 'app/features/moderation/AdminRouteGate'
import AuditLogScreen from 'app/features/moderation/AuditLogScreen'

export default function AdminAuditLogPage() {
  return (
    <AdminRouteGate>
      <AuditLogScreen />
    </AdminRouteGate>
  )
}
