// Developer view of the Collective: reaches the real feed regardless of the
// public `/collective` route, built into every build so devs can navigate to
// `/collective/dev`. Goes through CollectiveAccessGate so logged-out / sync-off
// devs see the guiding screens instead of a raw RLS feed error; a signed-in +
// synced dev lands straight on the feed.
// See packages/app/features/collective/isCollectiveDevEnabled.ts.
import CollectiveAccessGate from 'app/features/collective/CollectiveAccessGate'

export default function CollectiveDevScreen() {
  return <CollectiveAccessGate />
}
