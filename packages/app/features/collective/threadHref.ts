/**
 * threadHref.ts — the one place that knows how a Collective thread is addressed.
 *
 * Web and mobile use a dynamic path segment: `/collective/thread/<postId>`.
 * The desktop app cannot: it is a Next.js static export served by Tauri from a
 * folder of pre-rendered files, and a `[postId]` route would need every id
 * listed at build time. Desktop therefore uses a fixed page that reads the id
 * from the query string: `/collective/thread?postId=<postId>`. No desktop user
 * types, bookmarks or shares a URL, so the shape is an implementation detail.
 *
 * Every navigation to a thread goes through this helper so the two shapes
 * never diverge at a call site. `NEXT_PUBLIC_IS_DESKTOP_APP` is inlined by the
 * desktop build (apps/desktop/next.config.js) and absent everywhere else.
 */

export interface ThreadHrefOptions {
  /**
   * Root post id to return to when the target is a focused sub-thread. Passed
   * through as the `focusedFromRoot` query param on every platform.
   */
  focusedFromRoot?: string | null
}

export function isDesktopAppBuild(): boolean {
  return process.env.NEXT_PUBLIC_IS_DESKTOP_APP === 'true'
}

export function threadHref(postId: string, options: ThreadHrefOptions = {}): string {
  const focusedFromRoot = options.focusedFromRoot ?? null

  if (isDesktopAppBuild()) {
    const params = new URLSearchParams({ postId })
    if (focusedFromRoot) params.set('focusedFromRoot', focusedFromRoot)
    return `/collective/thread?${params.toString()}`
  }

  const base = `/collective/thread/${postId}`
  return focusedFromRoot ? `${base}?focusedFromRoot=${focusedFromRoot}` : base
}
