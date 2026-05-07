// packages/app/features/collective/ThreadView.tsx
//
// Flagship Collective thread surface. Renders a post-and-replies hierarchy with
// depth rails, per-subtree lazy expansion, inline reply composer, and focus routing.
//
// Architecture invariant: ThreadView is a RENDERER, not a state owner.
// All data fetching is delegated to useThread(); mutation optimistic UX to
// PostComposer + useCreatePost(); deletion rendering to PostRow.
//
// Boundary rule (D7): no Legend-State imports in this file.
// This file does NOT touch PersistentEditor or ephemeral$.persistentEditor.* (D14).

import React, { useState, useCallback, type ReactNode } from 'react'
import { Platform } from 'react-native'

// Flush React updates synchronously when available (web/test environments).
// Falls back to direct invocation on React Native where react-dom is absent.
// This is needed for onSubmitted / onCancelled callbacks that are invoked
// outside React event handlers (e.g. directly in tests or by composer logic).
function safeFlushSync(fn: () => void): void {
  try {
    // Dynamic require keeps RN bundlers from including react-dom in native bundles.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { flushSync } = require('react-dom') as typeof import('react-dom')
    flushSync(fn)
  } catch {
    fn()
  }
}
import { View, XStack, YStack, Text, ExpandingLineButton } from '@my/ui'
import { useRouter, useSearchParams } from 'solito/navigation'
import { useThread } from 'app/state/collective/thread'
import type { ThreadPost } from 'app/state/collective/thread'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useIsSuspended } from 'app/state/collective/suspension'
import { useLocallyHiddenPostIds } from 'app/state/collective/locallyHidden'
import { PostRow } from 'app/features/collective/PostRow'
import { FlagAffordance } from 'app/features/collective/FlagAffordance'
import PostComposer from 'app/features/collective/PostComposer'

// ─── Depth cap ────────────────────────────────────────────────────────────────
// Depth caps tuned for: mobile rail-stack readability, web content-density.
// Revisit after dogfood feedback (deferred-decisions #2).
const WEB_DEPTH_CAP = 6
const MOBILE_DEPTH_CAP = 4


// Hard recursion safety cap (defense-in-depth for any data cycle; well above visible cap).
const MAX_SAFE_DEPTH = 100

// Validate focusedFromRoot param: non-empty alphanumeric+dash (covers UUIDs + test ids).
// Defense against URL pollution per Security Audit findings.
const SAFE_ID_RE = /^[0-9a-zA-Z_.-]{1,128}$/

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ThreadViewProps {
  postId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count all loaded descendants of a post in the flat RPC list (via childrenByParent map).
 * Used to determine if a subtree is fully loaded (all descendants are present in the
 * flat list). descendant_count in the database counts ALL descendants at all levels.
 */
function countLoadedDescendants(
  postId: string,
  childrenByParent: Map<string, ThreadPost[]>
): number {
  const children = childrenByParent.get(postId) ?? []
  return children.reduce(
    (sum, c) => sum + 1 + countLoadedDescendants(c.id, childrenByParent),
    0
  )
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

const SKELETON_WIDTHS = ['85%', '70%', '92%', '60%', '78%'] as const

function SkeletonRows() {
  return (
    <YStack>
      {SKELETON_WIDTHS.map((width, i) => (
        <XStack
          key={i}
          data-testid={`skeleton-row-${i}`}
          height={14}
          borderRadius={0}
          backgroundColor="$color3"
          opacity={0.6}
          marginVertical="$2"
          width={width as string}
          animation="quick"
          enterStyle={{ opacity: 0 }}
        />
      ))}
    </YStack>
  )
}

// ─── ThreadExpansion — per-subtree lazy expansion ─────────────────────────────
// Each user-tapped subtree mounts one of these; it calls useThread(id, expansion)
// and renders via the parent's renderPost function (passed as prop).
//
// This component exists because hooks cannot be called conditionally inside a
// function-component render. The user taps "View N more replies" → ThreadView adds
// the postId to expandedSubtreeIds → React mounts ThreadExpansion → useThread runs.
//
// Cache note: gcTime: 5min for expansion instances (Story 3-4). Collapsing unmounts
// the component but the cache entry survives; re-expanding within 5min hits cache.

interface ThreadExpansionProps {
  postId: string
  depth: number
  renderPost: (post: ThreadPost, depth: number, isRoot: boolean) => ReactNode
}

function ThreadExpansion({ postId, depth, renderPost }: ThreadExpansionProps) {
  const expansion = useThread(postId, { role: 'expansion' })

  if (expansion.isLoading && !expansion.data) return null

  const items = expansion.data?.pages.flatMap((p) => p.items) ?? []
  // Only yield direct children of the expanded post.
  const children = items.filter((p) => p.parent_post_id === postId)

  return (
    <>
      {children.map((child) => (
        <React.Fragment key={child.id}>
          {renderPost(child, depth, false)}
        </React.Fragment>
      ))}
    </>
  )
}

// ─── ThreadView ───────────────────────────────────────────────────────────────

export default function ThreadView({ postId }: ThreadViewProps) {
  // ─── Hooks — all unconditionally at top (Rules of Hooks) ──────────────────
  const router = useRouter()
  const searchParams = useSearchParams()
  const getParam = (key: string) => searchParams?.get?.(key as any) ?? null
  const currentUserId = useCurrentUserId()
  const isSuspended = useIsSuspended(currentUserId ?? null)
  const hiddenIds = useLocallyHiddenPostIds()
  const root = useThread(postId, { role: 'root' })

  // Per-session collapse state — Set of post ids whose subtrees are collapsed.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  // Single active inline composer (only one across the whole tree at a time).
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null)
  // Expanded subtree ids — each triggers a <ThreadExpansion> mount.
  const [expandedSubtreeIds, setExpandedSubtreeIds] = useState<Set<string>>(() => new Set())

  // ─── Platform depth cap ────────────────────────────────────────────────────
  // Platform.OS === 'web' covers both web and Tauri/desktop (both use web renderer).
  const cap = Platform.OS === 'web' ? WEB_DEPTH_CAP : MOBILE_DEPTH_CAP

  // ─── focusedFromRoot — read from query param ───────────────────────────────
  const rawFocusedFromRoot = getParam('focusedFromRoot')
  const focusedFromRoot = rawFocusedFromRoot && SAFE_ID_RE.test(rawFocusedFromRoot)
    ? rawFocusedFromRoot
    : null

  // ─── Reply guard ───────────────────────────────────────────────────────────
  const mode = root.data?.pages[0]?.mode
  const canReply = currentUserId !== null
    && currentUserId !== undefined
    && isSuspended !== true
    && mode !== 'preview'

  // ─── Full child-index map from the flat RPC result ────────────────────────
  // The RPC returns a flat list of posts. We index ALL items by parent_post_id
  // for recursive rendering. Items are rendered inline when the subtree is
  // fully loaded (allLoaded). Items requiring more data use ThreadExpansion.
  const allItems = root.data?.pages.flatMap((p) => p.items) ?? []
  const childrenByParent = new Map<string, ThreadPost[]>()
  for (const item of allItems) {
    if (item.parent_post_id) {
      const arr = childrenByParent.get(item.parent_post_id) ?? []
      arr.push(item)
      childrenByParent.set(item.parent_post_id, arr)
    }
  }

  // ─── Recursive post renderer ───────────────────────────────────────────────
  const renderPost = useCallback(
    (post: ThreadPost, depth: number, isRoot: boolean): ReactNode => {
      // Safety: hard recursion cap against any data cycle.
      if (depth > MAX_SAFE_DEPTH) return null

      // Local-hide filter — also suppresses descendants.
      if (hiddenIds.has(post.id)) return null

      // Moderator-removed root fallback (chaos-monkey #3 mitigation).
      if (post.is_removed && isRoot) {
        return (
          <View key={post.id}>
            <Text fontSize="$3" color="$color9" textAlign="center" paddingVertical="$4">
              This thread was removed.
            </Text>
          </View>
        )
      }

      const hasDescendants = (post.descendant_count ?? 0) > 0
      const isCollapsed = collapsedIds.has(post.id)
      const isExpanded = expandedSubtreeIds.has(post.id)
      const atCap = depth >= cap

      // Direct children from the flat list (filter hidden).
      const loadedChildren = (childrenByParent.get(post.id) ?? [])
        .filter((c) => !hiddenIds.has(c.id))

      // Compute how many total descendants are present in the flat list (recursively).
      // This is compared with descendant_count (which counts ALL descendants at all levels).
      const loadedDescCount = countLoadedDescendants(post.id, childrenByParent)

      // allLoaded: the entire subtree is present in the flat list — render inline.
      // hasUnloaded: there are more descendants to load via ThreadExpansion.
      const allLoaded = hasDescendants && loadedDescCount >= (post.descendant_count ?? 0)
      const hasUnloaded = hasDescendants && !allLoaded

      // aria-expanded: omit when there is no content to expand/collapse (AC #6).
      const ariaExpanded = hasDescendants ? !isCollapsed : undefined

      // ─── Inner content (shared at all depths) ──────────────────────────────
      const innerContent = (
        <>
          {/* PostRow — delegation for all post body rendering */}
          <PostRow
            post={post as any}
            currentUserId={currentUserId}
            disabled={isSuspended === true}
          />

          {/* FlagAffordance — replies get canFocus=true; root gets canFocus=false */}
          <FlagAffordance
            postId={post.id}
            reporterUserId={currentUserId ?? null}
            canReport={post.user_id !== currentUserId && !post.is_user_deleted && post.user_id !== null}
            canSelfDelete={post.user_id === currentUserId && !post.is_user_deleted}
            canFocus={!isRoot}
            onFocus={!isRoot ? () => {
              const rootId = focusedFromRoot ?? postId
              router.push(`/collective/thread/${post.id}?focusedFromRoot=${rootId}`)
            } : undefined}
          />

          {/* Reply affordance — visible for authenticated, non-suspended users.
              Root post uses "Reply to this thread" label; replies use "Reply to this post"
              so that aria-label queries can uniquely target each context. */}
          {canReply ? (
            <View
              role="button"
              aria-label={isRoot ? 'Reply to this thread' : 'Reply to this post'}
              onPress={() => setActiveReplyId(post.id)}
              cursor="pointer"
            >
              <Text fontSize="$1" color="$color9" fontFamily="$body">
                Reply
              </Text>
            </View>
          ) : null}

          {/* Inline composer — one at a time. key ensures state teardown on post change. */}
          {activeReplyId === post.id ? (
            <PostComposer
              key={activeReplyId}
              compact
              replyContext={{ parentPostId: post.id }}
              onSubmitted={() => safeFlushSync(() => setActiveReplyId(null))}
              onCancelled={() => safeFlushSync(() => setActiveReplyId(null))}
            />
          ) : null}

          {/* Expansion / depth-cap affordances — priority: cap > collapsed > expanded > unloaded */}
          {atCap && hasDescendants ? (
            /* Depth cap: route to a focused subthread */
            <View
              onPress={() => {
                const rootId = focusedFromRoot ?? postId
                router.push(`/collective/thread/${post.id}?focusedFromRoot=${rootId}`)
              }}
              cursor="pointer"
            >
              <Text fontSize="$1" color="$color9" fontFamily="$body">
                Continue this thread →
              </Text>
            </View>
          ) : isCollapsed && hasDescendants ? (
            /* Collapsed via rail tap — re-expand */
            <View
              onPress={() => setCollapsedIds((prev) => {
                const next = new Set(prev)
                next.delete(post.id)
                return next
              })}
              cursor="pointer"
            >
              <Text fontSize="$1" color="$color9" fontFamily="$body">
                {post.descendant_count === 1 ? 'View 1 more reply' : `View ${post.descendant_count} more replies`}
              </Text>
            </View>
          ) : isExpanded && hasUnloaded ? (
            /* User-triggered expansion is active — allow collapsing */
            <View
              onPress={() => setExpandedSubtreeIds((prev) => {
                const next = new Set(prev)
                next.delete(post.id)
                return next
              })}
              cursor="pointer"
            >
              <Text fontSize="$1" color="$color9" fontFamily="$body">
                Hide replies
              </Text>
            </View>
          ) : !isExpanded && hasUnloaded && !atCap ? (
            /* Unloaded descendants exist — offer to load via ThreadExpansion */
            <View
              onPress={() => setExpandedSubtreeIds((prev) => new Set(prev).add(post.id))}
              cursor="pointer"
            >
              <Text fontSize="$1" color="$color9" fontFamily="$body">
                {post.descendant_count === 1 ? 'View 1 more reply' : `View ${post.descendant_count} more replies`}
              </Text>
            </View>
          ) : null}

          {/* Children rendering — only when not at cap and not collapsed */}
          {!atCap && !isCollapsed && (allLoaded || (isExpanded && hasUnloaded)) ? (
            <View tag="ul" role="group">
              {/* Inline render when all descendants are loaded (allLoaded) */}
              {allLoaded ? (
                loadedChildren.map((child) => (
                  <React.Fragment key={child.id}>
                    {renderPost(child, depth + 1, false)}
                  </React.Fragment>
                ))
              ) : null}
              {/* ThreadExpansion for user-triggered loading of unloaded subtrees */}
              {isExpanded && hasUnloaded ? (
                <ThreadExpansion
                  postId={post.id}
                  depth={depth + 1}
                  renderPost={renderPost}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )

      // ─── Wrap in li[role="treeitem"] ──────────────────────────────────────
      if (depth >= 1) {
        return (
          <View
            key={post.id}
            tag="li"
            role="treeitem"
            aria-level={depth + 1}
            {...(ariaExpanded !== undefined ? { 'aria-expanded': ariaExpanded } : {})}
          >
            <XStack>
              {/* Depth rail — left border strip that is the only tappable collapse target.
                  Isolated from innerContent so affordance button clicks don't bubble here. */}
              <View
                data-testid={`depth-rail-${post.id}`}
                data-depth={depth}
                width={12}
                borderLeftWidth={1}
                borderLeftColor="$color3"
                role="button"
                aria-label={isCollapsed ? 'Expand subtree' : 'Collapse subtree'}
                onPress={() => setCollapsedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(post.id)) {
                    next.delete(post.id)
                  } else {
                    next.add(post.id)
                  }
                  return next
                })}
              />
              {/* Post content — sibling to the rail, not a child, so clicks don't bubble up to rail */}
              <View flex={1} paddingLeft="$2">
                {innerContent}
              </View>
            </XStack>
          </View>
        )
      }

      // Depth 0 (root): no depth rail, no tappable collapse.
      return (
        <View
          key={post.id}
          tag="li"
          role="treeitem"
          aria-level={1}
          {...(ariaExpanded !== undefined ? { 'aria-expanded': ariaExpanded } : {})}
        >
          <View flex={1}>
            {innerContent}
          </View>
        </View>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      cap, hiddenIds, collapsedIds, expandedSubtreeIds, activeReplyId,
      canReply, currentUserId, isSuspended, focusedFromRoot, postId, router,
      childrenByParent,
    ]
  )

  // ─── Loading state (cold cache) ────────────────────────────────────────────
  if (root.isLoading && !root.data) {
    return (
      <View tag="ul" role="tree" maxWidth={720} marginHorizontal="auto" width="100%">
        <SkeletonRows />
      </View>
    )
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (root.error && !root.data) {
    return (
      <View tag="ul" role="tree" maxWidth={720} marginHorizontal="auto" width="100%">
        <Text fontSize="$2" color="$color9" textAlign="center" paddingVertical="$4">
          Couldn&apos;t load this thread.
        </Text>
        <ExpandingLineButton onPress={() => root.refetch()}>
          Retry
        </ExpandingLineButton>
      </View>
    )
  }

  // ─── Find the root post ────────────────────────────────────────────────────
  const rootPost = allItems.find((p) => p.id === postId) ?? allItems[0]

  return (
    <View tag="ul" role="tree" maxWidth={720} marginHorizontal="auto" width="100%">
      {/* Back to full thread — shown when this is a focused subthread */}
      {focusedFromRoot && focusedFromRoot !== postId ? (
        <ExpandingLineButton
          onPress={() => router.push(`/collective/thread/${focusedFromRoot}`)}
        >
          Back to full thread
        </ExpandingLineButton>
      ) : null}

      {/* Root post at depth 0; its descendants rendered recursively via renderPost */}
      {rootPost ? renderPost(rootPost, 0, true) : null}
    </View>
  )
}
