// Temporary: showing CollectivePlaceholderScreen while the real CollectiveFeedScreen is being
// re-styled. Swap the import back to 'app/features/collective/CollectiveFeedScreen' to revert.
import CollectivePlaceholderScreen from 'app/features/navigation/CollectivePlaceholderScreen'

export default function CollectiveScreen() {
  return <CollectivePlaceholderScreen />
}
