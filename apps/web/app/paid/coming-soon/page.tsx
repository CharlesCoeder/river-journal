'use client'

import Link from 'next/link'

export default function PaidComingSoonPage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '16px',
      }}
    >
      <p>Paid tier coming soon</p>
      <Link href="/settings">Back to Settings</Link>
    </div>
  )
}
