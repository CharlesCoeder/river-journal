'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ThreadView from 'app/features/collective/ThreadView'

// Desktop is a Next.js static export served by Tauri from pre-rendered files,
// so a `[postId]` dynamic segment cannot exist here (it would need every id
// listed at build time). This fixed page reads the id from the query string
// instead; every navigation to a thread builds that URL through
// `app/features/collective/threadHref.ts`, which is the only place the desktop
// and web/mobile shapes differ. Web keeps its `[postId]` route.
//
// `useSearchParams` must sit under a Suspense boundary for static prerender.

function DesktopThreadPage() {
  const postId = useSearchParams().get('postId') ?? ''
  return <ThreadView postId={postId} />
}

export default function CollectiveThreadPage() {
  return (
    <Suspense fallback={null}>
      <DesktopThreadPage />
    </Suspense>
  )
}
