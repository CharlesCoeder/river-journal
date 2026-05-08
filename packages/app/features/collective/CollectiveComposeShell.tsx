// Warms the feed cache so the create-post mutation's optimistic onMutate
// has a snapshot to prepend onto on direct-URL loads of /collective/compose.

import React from 'react'
import PostComposer from './PostComposer'
import { useFeed } from 'app/state/collective/feed'

export default function CollectiveComposeShell() {
  useFeed()
  return <PostComposer />
}
