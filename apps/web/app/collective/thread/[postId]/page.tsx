'use client'

import ThreadView from 'app/features/collective/ThreadView'

export default function CollectiveThreadPage({ params }: { params: { postId: string } }) {
  return <ThreadView postId={params.postId} />
}
