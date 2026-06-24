'use client'

import { use } from 'react'
import ThreadView from 'app/features/collective/ThreadView'

// Next.js 16: route `params` is a Promise in client components and must be
// unwrapped with React.use() — reading `params.postId` directly yields
// undefined, which left ThreadView with an empty postId (no thread rendered).
export default function CollectiveThreadPage({
  params,
}: {
  params: Promise<{ postId: string }>
}) {
  const { postId } = use(params)
  return <ThreadView postId={postId} />
}
