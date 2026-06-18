'use client'

// Developer view of the Collective: always renders the real CollectiveFeedScreen,
// regardless of the placeholder shown on the public `/collective` route. This is
// built into every build so devs can reach the real feed on production by typing
// `/collective/dev`. See packages/app/features/collective/isCollectiveDevEnabled.ts.
import CollectiveFeedScreen from 'app/features/collective/CollectiveFeedScreen'

export default function CollectiveDevPage() {
  return <CollectiveFeedScreen />
}
