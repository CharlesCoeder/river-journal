// Developer view of the Collective: always renders the real CollectiveFeedScreen,
// regardless of the placeholder shown on the public `/collective` route. Built into
// every build so devs can reach the real feed by navigating to `/collective/dev`.
// See packages/app/features/collective/isCollectiveDevEnabled.ts.
import CollectiveFeedScreen from 'app/features/collective/CollectiveFeedScreen'

export default function CollectiveDevScreen() {
  return <CollectiveFeedScreen />
}
