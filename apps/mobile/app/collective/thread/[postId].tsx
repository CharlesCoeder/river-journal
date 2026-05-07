import { useLocalSearchParams } from 'expo-router'
import ThreadView from 'app/features/collective/ThreadView'

export default function CollectiveThreadScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>()
  return <ThreadView postId={postId} />
}
