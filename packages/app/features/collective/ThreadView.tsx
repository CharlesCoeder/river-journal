// packages/app/features/collective/ThreadView.tsx
//
// Flagship Collective thread surface — title-led redesign (Story 3-16).
//
// Shape (mirrors docs/collective-design-reference CollectiveThread.tsx):
//   • a "Back to the room" link
//   • the ROOT letter: title (h1) + byline + full body + interactive reactions
//     + reply, sourced from useThreadRoot() (the feed RPC no longer carries
//     `body`, so the root's body has no other source — Story 3-16 follow-up #1)
//   • a branching reply tree: each reply is byline + body + reactions, nested
//     under left depth rails, with a depth cap + "view N more replies" affordance
//
// Architecture invariant: ThreadView is a RENDERER, not a state owner.
//   • root data → useThreadRoot(postId)
//   • reply tree → useThread(postId) (+ lazy useThread per expanded subtree)
//   • mutation optimistic UX → PostComposer + useCreatePost()
//   • reactions → ReactionStrip / useToggleReaction
//
// Boundary rule (D7): no Legend-State imports in this file.
// This file does NOT touch PersistentEditor or ephemeral$.persistentEditor.* (D14).

import React, { useState, useCallback, useEffect, type ReactNode } from 'react'
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
import { AnimatePresence, View, XStack, YStack, Text, ExpandingLineButton } from '@my/ui'
import { ArrowLeft, CornerUpLeft } from '@tamagui/lucide-icons'
import { useRouter, useSearchParams } from 'solito/navigation'
import { useThread, useThreadRoot } from 'app/state/collective/thread'
import type { ThreadPost } from 'app/state/collective/thread'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useIsSuspended } from 'app/state/collective/suspension'
import { useLocallyHiddenPostIds } from 'app/state/collective/locallyHidden'
import { ReactionStrip } from 'app/features/collective/ReactionStrip'
import { FlagAffordance } from 'app/features/collective/FlagAffordance'
import PostComposer from 'app/features/collective/PostComposer'
import { CollectiveEligibilityGate } from 'app/features/collective/CollectiveEligibilityGate'
import { timeAgoCasual } from './_shared'

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
  return children.reduce((sum, c) => sum + 1 + countLoadedDescendants(c.id, childrenByParent), 0)
}

// ─── Byline ───────────────────────────────────────────────────────────────────
// Interim identity (architecture §9 / D7): the design shows pen names; the real
// RPC returns only user_id + tenure. Render "You" for your own posts, the
// user_id slice otherwise, "[deleted]" for withdrawn/anonymized authors.

function NodeByline({
  post,
  currentUserId,
}: {
  post: ThreadPost
  currentUserId: string | null | undefined
}) {
  const isDeleted = post.is_user_deleted || post.user_id === null
  const mine = post.user_id != null && post.user_id === currentUserId
  const name = isDeleted ? '[deleted]' : mine ? 'You' : (post.user_id?.slice(0, 8) ?? '[deleted]')
  return (
    <Text
      fontFamily="$body"
      fontSize="$1"
      color="$color9"
      textTransform="uppercase"
      letterSpacing={1}
    >
      {name}
      {'  ·  '}
      {timeAgoCasual(post.created_at)}
    </Text>
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
        <React.Fragment key={child.id}>{renderPost(child, depth, false)}</React.Fragment>
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
  // Root post (title + full body) — the feed RPC dropped `body`, so this is the
  // ONLY source for the root's body. Story 3-16 follow-up #1.
  const rootQuery = useThreadRoot(postId)
  // Reply tree (direct children of the root; deeper levels lazy-load).
  const tree = useThread(postId, { role: 'root' })

  // Per-session collapse state — Set of post ids whose subtrees are collapsed.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  // Single active inline composer (only one across the whole tree at a time).
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null)
  // Expanded subtree ids — each triggers a <ThreadExpansion> mount.
  const [expandedSubtreeIds, setExpandedSubtreeIds] = useState<Set<string>>(() => new Set())

  // Ease the thread in on mount — mirrors the feed/Settings entrance so opening a
  // letter fades into view rather than popping in. The `mounted` gate forces a
  // genuine client-side mount so Tamagui replays `enterStyle` reliably.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // ─── Platform depth cap ────────────────────────────────────────────────────
  // Platform.OS === 'web' covers both web and Tauri/desktop (both use web renderer).
  const cap = Platform.OS === 'web' ? WEB_DEPTH_CAP : MOBILE_DEPTH_CAP

  // ─── focusedFromRoot — read from query param ───────────────────────────────
  const rawFocusedFromRoot = getParam('focusedFromRoot')
  const focusedFromRoot =
    rawFocusedFromRoot && SAFE_ID_RE.test(rawFocusedFromRoot) ? rawFocusedFromRoot : null

  // ─── Reply guard ───────────────────────────────────────────────────────────
  const mode = rootQuery.data?.mode
  const canReply =
    currentUserId !== null &&
    currentUserId !== undefined &&
    isSuspended !== true &&
    mode !== 'preview'

  // ─── Full child-index map from the flat RPC result ────────────────────────
  // useThread(root) returns the root's direct children (deeper levels arrive via
  // ThreadExpansion). We index ALL loaded items by parent_post_id for recursive
  // rendering.
  const allItems = tree.data?.pages.flatMap((p) => p.items) ?? []
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
            <Text
              fontSize="$3"
              color="$color9"
              textAlign="center"
              paddingVertical="$4"
            >
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
      const loadedChildren = (childrenByParent.get(post.id) ?? []).filter(
        (c) => !hiddenIds.has(c.id)
      )

      // Compute how many total descendants are present in the flat list (recursively).
      // This is compared with descendant_count (which counts ALL descendants at all levels).
      const loadedDescCount = countLoadedDescendants(post.id, childrenByParent)

      // allLoaded: the entire subtree is present in the flat list — render inline.
      // hasUnloaded: there are more descendants to load via ThreadExpansion.
      const allLoaded = hasDescendants && loadedDescCount >= (post.descendant_count ?? 0)
      const hasUnloaded = hasDescendants && !allLoaded

      // aria-expanded: omit when there is no content to expand/collapse (AC #6).
      const ariaExpanded = hasDescendants ? !isCollapsed : undefined

      // Deletion state: self-deleted → tombstone; anonymized → body shown, author
      // anonymised; normal → body shown.
      const selfDeleted = post.is_user_deleted === true

      // ─── The letter / reply content ────────────────────────────────────────
      const nodeContent = selfDeleted ? (
        <Text
          fontFamily="$journal"
          fontSize={isRoot ? '$6' : '$5'}
          color="$color8"
          fontStyle="italic"
        >
          {isRoot ? 'This letter was withdrawn.' : 'This reply was withdrawn.'}
        </Text>
      ) : (
        <YStack gap="$3">
          {isRoot && post.title ? (
            <Text
              tag="h1"
              fontFamily="$journal"
              fontSize="$9"
              lineHeight="$9"
              color="$color12"
            >
              {post.title}
            </Text>
          ) : null}
          <NodeByline
            post={post}
            currentUserId={currentUserId}
          />
          <Text
            fontFamily="$journal"
            fontSize={isRoot ? '$6' : '$5'}
            color="$color12"
            whiteSpace="pre-wrap"
          >
            {post.body}
          </Text>
          {/* Action row: reactions on the left, reply + moderation on the right */}
          <XStack
            justifyContent="space-between"
            alignItems="center"
            gap="$5"
            flexWrap="wrap"
            marginTop="$1"
          >
            {currentUserId !== undefined ? (
              <ReactionStrip
                postId={post.id}
                userId={currentUserId ?? null}
                disabled={isSuspended === true}
              />
            ) : (
              <View />
            )}
            <XStack
              alignItems="center"
              gap="$4"
            >
              {canReply ? (
                <View
                  role="button"
                  aria-label={isRoot ? 'Reply to this thread' : 'Reply to this post'}
                  onPress={() => setActiveReplyId(post.id)}
                  cursor="pointer"
                >
                  <XStack
                    alignItems="center"
                    gap="$1.5"
                  >
                    <CornerUpLeft
                      size={14}
                      color="$color9"
                    />
                    <Text
                      fontSize="$1"
                      color="$color9"
                      fontFamily="$body"
                      textTransform="uppercase"
                      letterSpacing={1}
                    >
                      Reply
                    </Text>
                  </XStack>
                </View>
              ) : null}
              <FlagAffordance
                postId={post.id}
                reporterUserId={currentUserId ?? null}
                canReport={
                  post.user_id !== currentUserId && !post.is_user_deleted && post.user_id !== null
                }
                canSelfDelete={post.user_id === currentUserId && !post.is_user_deleted}
                canFocus={!isRoot}
                onFocus={
                  !isRoot
                    ? () => {
                        const rootId = focusedFromRoot ?? postId
                        router.push(`/collective/thread/${post.id}?focusedFromRoot=${rootId}`)
                      }
                    : undefined
                }
              />
            </XStack>
          </XStack>
        </YStack>
      )

      // ─── Inner content (shared at all depths) ──────────────────────────────
      const innerContent = (
        <>
          {nodeContent}

          {/* Reply-count label — shown under the root only, mirrors the design. */}
          {isRoot ? (
            <Text
              fontFamily="$body"
              fontSize="$1"
              color="$color9"
              textTransform="uppercase"
              letterSpacing={1}
              marginTop="$8"
              marginBottom="$2"
            >
              {(post.descendant_count ?? 0) === 0
                ? 'No replies yet'
                : (post.descendant_count ?? 0) === 1
                  ? '1 reply'
                  : `${post.descendant_count} replies`}
            </Text>
          ) : null}

          {/* Inline composer — one at a time. key ensures state teardown on post change.
              Wrapped in CollectiveEligibilityGate (compact variant) so an ineligible
              user sees an explainer instead of a writing surface. The gate's onCancel
              closes the inline slot when the editor never mounts (PostComposer's own
              onCancelled won't fire in those branches). */}
          {activeReplyId === post.id ? (
            <CollectiveEligibilityGate
              variant="compact"
              onCancel={() => safeFlushSync(() => setActiveReplyId(null))}
            >
              <PostComposer
                key={activeReplyId}
                compact
                replyContext={{ parentPostId: post.id }}
                onSubmitted={() => safeFlushSync(() => setActiveReplyId(null))}
                onCancelled={() => safeFlushSync(() => setActiveReplyId(null))}
              />
            </CollectiveEligibilityGate>
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
              marginTop="$4"
            >
              <Text
                fontSize="$1"
                color="$color9"
                fontFamily="$body"
                textTransform="uppercase"
                letterSpacing={1}
              >
                Continue this thread →
              </Text>
            </View>
          ) : isCollapsed && hasDescendants ? (
            /* Collapsed via rail tap — re-expand */
            <View
              onPress={() =>
                setCollapsedIds((prev) => {
                  const next = new Set(prev)
                  next.delete(post.id)
                  return next
                })
              }
              cursor="pointer"
              marginTop="$4"
            >
              <Text
                fontSize="$1"
                color="$color9"
                fontFamily="$body"
                textTransform="uppercase"
                letterSpacing={1}
              >
                {post.descendant_count === 1
                  ? 'View 1 more reply'
                  : `View ${post.descendant_count} more replies`}
              </Text>
            </View>
          ) : isExpanded && hasUnloaded ? (
            /* User-triggered expansion is active — allow collapsing */
            <View
              onPress={() =>
                setExpandedSubtreeIds((prev) => {
                  const next = new Set(prev)
                  next.delete(post.id)
                  return next
                })
              }
              cursor="pointer"
              marginTop="$4"
            >
              <Text
                fontSize="$1"
                color="$color9"
                fontFamily="$body"
                textTransform="uppercase"
                letterSpacing={1}
              >
                Hide replies
              </Text>
            </View>
          ) : !isExpanded && hasUnloaded && !atCap ? (
            /* Unloaded descendants exist — offer to load via ThreadExpansion */
            <View
              onPress={() => setExpandedSubtreeIds((prev) => new Set(prev).add(post.id))}
              cursor="pointer"
              marginTop="$4"
            >
              <Text
                fontSize="$1"
                color="$color9"
                fontFamily="$body"
                textTransform="uppercase"
                letterSpacing={1}
              >
                {post.descendant_count === 1
                  ? 'View 1 more reply'
                  : `View ${post.descendant_count} more replies`}
              </Text>
            </View>
          ) : null}

          {/* Children rendering — only when not at cap and not collapsed */}
          {!atCap && !isCollapsed && (allLoaded || (isExpanded && hasUnloaded)) ? (
            <View
              tag="ul"
              role="group"
              marginTop="$6"
            >
              {/* Inline render when all descendants are loaded (allLoaded) */}
              {allLoaded
                ? loadedChildren.map((child) => (
                    <React.Fragment key={child.id}>
                      {renderPost(child, depth + 1, false)}
                    </React.Fragment>
                  ))
                : null}
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
      // Replies (depth >= 1) sit inside a left depth rail that doubles as the
      // tappable collapse target. The root (depth 0) has no rail.
      if (depth >= 1) {
        return (
          <View
            key={post.id}
            tag="li"
            role="treeitem"
            aria-level={depth + 1}
            marginTop="$8"
            {...(ariaExpanded !== undefined ? { 'aria-expanded': ariaExpanded } : {})}
          >
            <XStack>
              {/* Depth rail — left border strip that is the only tappable collapse target.
                  Isolated from innerContent so affordance button clicks don't bubble here. */}
              <View
                data-testid={`depth-rail-${post.id}`}
                data-depth={depth}
                width={20}
                borderLeftWidth={1}
                borderLeftColor="$color4"
                role="button"
                aria-label={isCollapsed ? 'Expand subtree' : 'Collapse subtree'}
                onPress={() =>
                  setCollapsedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(post.id)) {
                      next.delete(post.id)
                    } else {
                      next.add(post.id)
                    }
                    return next
                  })
                }
              />
              {/* Post content — sibling to the rail, not a child, so clicks don't bubble up to rail */}
              <View
                flex={1}
                paddingLeft="$3"
              >
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
          <View flex={1}>{innerContent}</View>
        </View>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      cap,
      hiddenIds,
      collapsedIds,
      expandedSubtreeIds,
      activeReplyId,
      canReply,
      currentUserId,
      isSuspended,
      focusedFromRoot,
      postId,
      router,
      childrenByParent,
    ]
  )

  // ─── Loading state (cold cache) ────────────────────────────────────────────
  if (rootQuery.isLoading && !rootQuery.data) {
    return (
      <View
        tag="ul"
        role="tree"
        maxWidth={720}
        marginHorizontal="auto"
        width="100%"
        padding="$5"
      >
        <SkeletonRows />
      </View>
    )
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (rootQuery.error && !rootQuery.data) {
    return (
      <View
        tag="ul"
        role="tree"
        maxWidth={720}
        marginHorizontal="auto"
        width="100%"
        padding="$5"
      >
        <Text
          fontSize="$2"
          color="$color9"
          textAlign="center"
          paddingVertical="$4"
        >
          Couldn&apos;t load this thread.
        </Text>
        <ExpandingLineButton onPress={() => rootQuery.refetch()}>Retry</ExpandingLineButton>
      </View>
    )
  }

  // ─── Removed / not-found root ──────────────────────────────────────────────
  // collective_thread_root returns null when the root is moderator-removed or
  // does not exist (AC 11).
  if (rootQuery.data === null) {
    return (
      <View
        tag="ul"
        role="tree"
        maxWidth={720}
        marginHorizontal="auto"
        width="100%"
        padding="$5"
      >
        <Text
          fontSize="$3"
          color="$color9"
          textAlign="center"
          paddingVertical="$4"
        >
          This thread was removed.
        </Text>
      </View>
    )
  }

  const rootPost = rootQuery.data

  return (
    <AnimatePresence>
      {mounted && (
    <YStack
      key="collective-thread-body"
      transition="designEnter"
      enterStyle={{ opacity: 0, y: 10 }}
      opacity={1}
      y={0}
      maxWidth={720}
      marginHorizontal="auto"
      width="100%"
      paddingHorizontal="$5"
      paddingVertical="$8"
    >
      {/* Back to the room (or to the full thread when focused on a subthread) */}
      <View
        role="button"
        aria-label={
          focusedFromRoot && focusedFromRoot !== postId ? 'Back to full thread' : 'Back to the room'
        }
        onPress={() =>
          router.push(
            focusedFromRoot && focusedFromRoot !== postId
              ? `/collective/thread/${focusedFromRoot}`
              : '/collective/dev'
          )
        }
        cursor="pointer"
        marginBottom="$9"
      >
        <XStack
          alignItems="center"
          gap="$2"
        >
          <ArrowLeft
            size={16}
            color="$color9"
          />
          <Text
            fontSize="$2"
            color="$color9"
            fontFamily="$body"
          >
            {focusedFromRoot && focusedFromRoot !== postId
              ? 'Back to full thread'
              : 'Back to the room'}
          </Text>
        </XStack>
      </View>

      {/* Root letter at depth 0; its descendants rendered recursively via renderPost */}
      <View
        tag="ul"
        role="tree"
      >
        {rootPost ? renderPost(rootPost, 0, true) : null}
      </View>
    </YStack>
      )}
    </AnimatePresence>
  )
}
