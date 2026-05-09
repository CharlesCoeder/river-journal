// Warms the feed cache so the create-post mutation's optimistic onMutate
// has a snapshot to prepend onto on direct-URL loads of /collective/compose.
//
// Wraps the composer in CollectiveEligibilityGate (full variant) so the
// editor is never mounted for ineligible users — the gate replaces the
// writing surface with a state-specific explainer instead.

import React from 'react'
import PostComposer from './PostComposer'
import { CollectiveEligibilityGate } from './CollectiveEligibilityGate'
import { useFeed } from 'app/state/collective/feed'

export default function CollectiveComposeShell() {
  useFeed()
  return (
    <CollectiveEligibilityGate variant="full">
      <PostComposer />
    </CollectiveEligibilityGate>
  )
}
