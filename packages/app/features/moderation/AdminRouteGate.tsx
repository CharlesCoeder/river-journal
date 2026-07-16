// packages/app/features/moderation/AdminRouteGate.tsx
//
// Boundary rule (D7): no Legend-State imports in this file. The admin-status
// read happens inside `useIsAdmin` (the permitted features/ carve-out hook);
// this file only renders from the resolved value — mirrors CollectiveAccessGate.
//
// The UX-only gate that stands in front of the web + desktop admin routes. The
// REAL security boundary is server-side, independent of this gate: RLS policies
// + the SECURITY DEFINER moderation functions reject any non-admin RPC with 42501.
// A user can tamper with the in-memory JS session to satisfy this gate; that is
// expected and harmless because the server rejects them regardless.
//
// FAIL-CLOSED precedence ladder — the ONLY branch that renders `children` is an
// explicit `=== true`:
//   undefined (loading)      → neutral skeleton, never the admin content
//   anything else (null/false/
//     truthy-but-not-true)   → "Not authorized"
//   true                     → children
// Branching positively on `=== true` last is deliberate: a `if (!isAdmin)`
// early-return would render children for a truthy-but-not-`true` value, and a
// loading→admin flash would briefly mount real moderation UI for an unresolved
// session once the placeholder screens are replaced with data-bearing ones.

import type { ReactNode } from 'react'
import { Text, View, YStack, ExpandingLineButton } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useIsAdmin } from 'app/state/collective/isAdmin'

/**
 * Presentational "Not authorized" state with a "Return home" affordance.
 * Kept as a separate sub-component so the gate stays lean and this is reusable.
 */
export function NotAuthorized() {
  const router = useRouter()

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$4"
      padding="$6"
      data-testid="admin-route-gate-not-authorized"
    >
      <Text
        fontSize="$6"
        fontWeight="600"
      >
        Not authorized
      </Text>
      <Text
        opacity={0.7}
        textAlign="center"
      >
        You don't have access to this area.
      </Text>
      <ExpandingLineButton
        accessibilityLabel="Return home"
        onPress={() => router.push('/')}
      >
        Return home
      </ExpandingLineButton>
    </YStack>
  )
}

export function AdminRouteGate({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin()

  // loading: session not yet resolved — neutral state, never admin content.
  if (isAdmin === undefined) {
    return (
      <View
        flex={1}
        data-testid="admin-route-gate-loading"
      />
    )
  }

  // granted: the ONLY branch that renders children, gated on strict `=== true`.
  if (isAdmin === true) {
    return <>{children}</>
  }

  // denied: everything else (null / false / any truthy-but-not-`true` value).
  return <NotAuthorized />
}

export default AdminRouteGate
