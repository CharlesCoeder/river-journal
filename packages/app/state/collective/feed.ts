// packages/app/state/collective/feed.ts
//
// Collective feed data layer: paginated TanStack Query infinite query +
// the single legitimate cross-boundary observe() in the entire collective
// surface. This file is the cache-invalidation hook that watches the
// journal-side streak observable and invalidates the ['collective'] query
// key when the user crosses the daily 500-word gate mid-session.
//
// ─── BOUNDARY-RULE NARROW EXCEPTION ───────────────────────────────────────
// This is the ONLY place state/collective/** imports from Legend-State.
// We subscribe to the streak observable purely as a cache-invalidation
// trigger when the user crosses 500 mid-session — NOT as a data source.
//
// Architecture refs: epic-3-context.md "The Boundary Rule (D7) is binding
// for this epic" → "Documented narrow exception".
//
// Lifecycle: module-load top-level statement; no tear-down. The observation
// lives for the app lifetime, matching the pattern in state/streak.ts.
//
// Cross-references:
//   - state/collective/mutations.ts — eager-import discipline for setMutationDefaults.
//   - state/streak.ts                — defines store$.views.streak computed view.
//   - state/queryClient.ts           — singleton QueryClient.
// ──────────────────────────────────────────────────────────────────────────

import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query'
import { observe } from '@legendapp/state'
import { store$, entries$, flows$, graceDays$ } from 'app/state/store'
// Side-effect import: attaches the store$.views.streak computed view that this
// module's observe() depends on. Mirrors the discipline in initializeApp.ts.
import 'app/state/streak'
import { queryClient } from 'app/state/queryClient'
import { supabase } from 'app/utils/supabase'
import type { Database } from 'app/types/database'

// Page-size constant. Co-located with `collectiveFeedKey` so sibling stories
// (thread / yourPosts) can `import { PAGE_SIZE } from './feed'` as the
// single source of truth.
export const PAGE_SIZE = 20

// Stable query key tuple. Used both internally (in `useFeed`'s `queryKey`)
// and externally (mutation onSuccess invalidations).
export const collectiveFeedKey = ['collective', 'feed'] as const

// Post row shape — derived from the generated Database type, not hand-rolled,
// so future RPC schema regenerations propagate automatically.
export type Post = Database['public']['Functions']['collective_feed_page']['Returns'][number]

export interface FeedPage {
  items: Post[]
  mode: 'preview' | 'full'
  nextCursor: string | null
}

/**
 * Pure async fetcher — testable in isolation; consumed by `useFeed()`.
 *
 * Has-more detection via the +1 pattern: we ask the RPC for PAGE_SIZE + 1
 * rows; if we get all 21, the LAST row's `created_at` becomes the cursor for
 * the next page (the RPC's `WHERE cp.created_at < v_cursor` is strict-less-
 * than, so passing the row's own timestamp correctly skips it). If we get
 * fewer than PAGE_SIZE + 1, there's no next page.
 */
export async function fetchFeedPage(cursor: string | null): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('collective_feed_page', {
    cursor,
    page_size: PAGE_SIZE + 1,
  })

  if (error) throw error

  // Empty / null data — treat as full mode by default. The only path that
  // produces an empty array under preview mode is "no posts in DB at all",
  // which is a non-issue for mode dispatch.
  if (!data || data.length === 0) {
    return { items: [], mode: 'full', nextCursor: null }
  }

  // Defensive mode dispatch — RPC's `mode` column is TEXT, so a future schema
  // drift is theoretically possible. Anything other than 'preview' / 'full'
  // collapses to 'full'.
  const rawMode = (data[0] as { mode?: unknown }).mode
  const mode: 'preview' | 'full' =
    rawMode === 'preview' || rawMode === 'full' ? rawMode : 'full'

  // +1 has-more pattern: slice down to PAGE_SIZE; cursor is last sliced row.
  let items: Post[]
  let nextCursor: string | null = null
  if (data.length === PAGE_SIZE + 1) {
    items = data.slice(0, PAGE_SIZE) as Post[]
    // AC #19 defensive guard — only compute cursor if slice non-empty.
    if (items.length > 0) {
      // AC #20 — coerce to string at the boundary so persistence layer never
      // chokes on a future Date-typed `created_at` from a Database regen.
      const lastItem = items[items.length - 1]
      if (lastItem) nextCursor = String(lastItem.created_at)
    }
  } else {
    items = data as Post[]
    nextCursor = null
  }

  return { items, mode, nextCursor }
}

/**
 * `useFeed()` — zero-arg hook returning the bounded infinite query.
 *
 * Memory bound: maxPages: 5 × PAGE_SIZE: 20 = 100 posts in memory (NFR31).
 * As the user scrolls past 100 posts, TanStack Query drops the oldest pages.
 *
 * Polling cadence: 30s (calm; faster polling burns Supabase egress).
 * staleTime: 25s (strictly less than refetchInterval so refetches fire).
 *
 * Background polling: relies on TanStack Query v5's default
 * `refetchIntervalInBackground: false` to avoid battery drain when the app
 * is backgrounded. We do NOT set this property — the default is correct.
 */
export function useFeed(): UseInfiniteQueryResult<InfiniteData<FeedPage>, Error> {
  return useInfiniteQuery({
    queryKey: collectiveFeedKey,
    queryFn: ({ pageParam }) => fetchFeedPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    maxPages: 5,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 25_000,
  })
}

// ─── Defensive upstream activation ────────────────────────────────────────
// `state/streak.ts`'s computed view reads entries$/flows$/graceDays$ via
// `.get()`. In the production app, `initializeApp.ts` activates persistence
// before any consumer subscribes; in test environments (and theoretically
// during a regression where feed.ts is imported pre-initializeApp), one of
// the upstream observables may be uninitialized and the streak compute
// throws. We peek + seed each to `{}` if undefined so the streak view's
// first compute returns a usable StreakState rather than throwing silently.
try {
  if (entries$.peek() === undefined) entries$.set({})
  if (flows$.peek() === undefined) flows$.set({})
  if (graceDays$.peek() === undefined) graceDays$.set({})
} catch {
  // peek/set may throw under edge cases (lifecycle ordering); the observe()
  // try/catch below is the durable backstop.
}

// ─── Module-load cache-invalidation observe() ─────────────────────────────
// Sentinel is module-scoped (NOT inside the callback) so it persists across
// observe re-runs. A `let` declared inside the callback would reset every
// fire and break transition detection.
let previousLastQualifyingDate: string | null | undefined = undefined

observe(() => {
  try {
    // Read store$.views.streak.lastQualifyingDate via chained Legend-State
    // access. The `store$.views.streak` shape is a function-style computed;
    // TypeScript's generated typings model it as a callable, so we cast to
    // access the sub-observable. Runtime works because Legend-State exposes
    // computed-view properties as sub-observables.
    const streakView = store$.views.streak as unknown as {
      lastQualifyingDate: { get: () => string | null | undefined }
    }
    const next = streakView.lastQualifyingDate.get()

    // Skip the initial firing (observe fires once synchronously on attach).
    // We only invalidate on TRANSITIONS, not on cold-start subscribe —
    // otherwise we'd blow away every cold-start cache restore.
    if (previousLastQualifyingDate === undefined) {
      previousLastQualifyingDate = next ?? null
      return
    }

    const normalized = next ?? null
    if (previousLastQualifyingDate !== normalized) {
      previousLastQualifyingDate = normalized
      // AC #21 — defer invalidation via queueMicrotask to break any potential
      // synchronous re-entry loop with Legend-State's reaction queue. Still
      // completes in the same event-loop turn (no user-visible delay).
      queueMicrotask(() => {
        try {
          queryClient.invalidateQueries({ queryKey: ['collective'] })
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(
              '[feed.ts] queryClient.invalidateQueries threw inside queueMicrotask; ignoring',
              err
            )
          }
        }
      })
    }
  } catch (err) {
    // AC #17 — swallow + warn so a single throw does NOT tear down the
    // observation. Legend-State's reaction runner *may* discard the
    // subscription if a callback throws (version-dependent). The try/catch
    // ensures the observation continues firing on subsequent transitions.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[feed.ts] streak-transition observe() callback threw; ignoring', err)
    }
  }
})
