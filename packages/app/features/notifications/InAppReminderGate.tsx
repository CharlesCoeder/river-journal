/**
 * InAppReminderGate — the web/desktop-only in-app reminder card.
 *
 * Authenticated web/desktop users get no OS push at launch (that is
 * Growth-scoped), so this calm inline card on Home surfaces pending reminders —
 * streak-not-done, unread Collective replies, unacknowledged moderation actions
 * — each tappable to its context. Mobile NEVER renders it (push is its sole
 * channel), so a mobile user who received the push is not double-notified.
 *
 * It reads LOCAL state where possible (`store$.profile` for the streak
 * preference, `useTodayWordCount()` for today's 500, the reused receipt hooks
 * for moderation) plus ONE small server signal for unread replies
 * (`useUnreadReplies` → the `unread_replies_for_user` RPC, once per open).
 *
 * The unread-reply `since` bound is captured ONCE per app SESSION (not per
 * mount) into `ephemeral$.reminderRepliesSince`, gated on the profile having
 * hydrated from IndexedDB — the same mount advances the persisted
 * `repliesLastSeenAt`. Session-scoping + the hydration gate are load-bearing:
 * they stop a Home bounce from advancing the bound (self-clearing an unacted-on
 * replies reminder) and stop a cold-start hydration race from freezing `since`
 * at `now` (which would silently count ~0 forever).
 *
 * Cross-domain composition (allowed ONLY at the component layer): it reads both
 * Legend-State (`store$`, `ephemeral$`, `use$`) AND TanStack Query hooks
 * (`useCurrentUserId`, `useUnreadReplies`, the receipt hooks). That is exactly
 * why it is a feature component, not a `state/collective/**` file.
 *
 * Dismissal is per-session via `ephemeral$.reminderCardDismissed` (resets on
 * cold start); no pending categories → the card renders `null` regardless of the
 * dismiss flag.
 */

import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { Text, XStack, YStack } from '@my/ui'
import { store$, ephemeral$ } from 'app/state/store'
import { useCurrentUserId } from 'app/state/collective/currentUser'
import { useTodayWordCount } from 'app/state/collective/todayWordCount'
import { useUnreadReplies } from 'app/state/collective/unreadReplies'
import { useMyActiveSuspension } from 'app/state/collective/suspension'
import { useMyRemovedPosts } from 'app/state/collective/moderationReceipts'
import {
  hasAcknowledgedReceipt,
  removedPostReceiptId,
  suspensionReceiptId,
} from '../moderation-receipts/acknowledgment'
import { getRepliesLastSeenAt, markRepliesSeen } from './reminderPreferences'

// The precise threshold the streak cron gates on (`daily_500_completed_today`).
const DAILY_500 = 500

// The default streak send-time ('20:00'), as minutes-since-midnight.
const DEFAULT_STREAK_MINUTES = 20 * 60

// Parse an 'HH:mm' local time to minutes-since-midnight. Compared as INTEGERS,
// never a raw lexicographic string compare — an unpadded '9:30' sorts AFTER
// '20:00' lexically ('9' > '2') and would wrongly suppress the evening reminder.
// A malformed value ('8', '', '8:') yields NaN; since `currentMinutes >= NaN`
// is always false it would silently suppress the streak row forever, so fall
// back to the '20:00' default rather than let a corrupt preference hide it.
function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  const minutes = Number(h) * 60 + Number(m)
  return Number.isFinite(minutes) ? minutes : DEFAULT_STREAK_MINUTES
}

export function InAppReminderGate() {
  // Platform gate FIRST, before any hook — stable for the component's life, so
  // this is a clean "different component on native" split (native runs no
  // queries and no effect), not a conditional hook. Covers web browser AND the
  // Tauri desktop shell; no-ops on iOS/Android.
  if (Platform.OS !== 'web') return null
  return <InAppReminderCard />
}

function InAppReminderCard() {
  const router = useRouter()
  const userId = useCurrentUserId()
  const activeUserId = typeof userId === 'string' ? userId : null

  const profile = use$(store$.profile)
  // The profile hydrates ASYNCHRONOUSLY from IndexedDB on a web cold start,
  // while `activeUserId` resolves independently through Supabase auth. Gate the
  // `since` seed + the advance on the profile being hydrated (non-null) so we
  // never freeze `since` at `now` before the persisted `repliesLastSeenAt` is
  // readable — otherwise the primary "replies since last open" count silently
  // stays ~0 and never recovers.
  const profileReady = profile != null

  // The unread-reply `since` bound is SESSION-scoped, not per-mount: the card
  // remounts on every Home landing (journal → back, collective → back), so
  // pinning `since` + advancing the bound per mount would let a Home bounce
  // self-clear an unacted-on replies reminder. The session's pinned value lives
  // in `ephemeral$.reminderRepliesSince` (seeded once, reused on later mounts);
  // seed it here into non-reactive local state (a `useState` initializer runs
  // once, and we read via `peek`) so advancing the preference never re-keys the
  // in-flight unread-replies query and flashes the reply row away.
  const [since, setSince] = useState<string | null>(
    () => ephemeral$.reminderRepliesSince.peek() ?? null
  )

  const wordCount = useTodayWordCount()
  const unreadReplies = useUnreadReplies(activeUserId, since)
  const suspension = useMyActiveSuspension(activeUserId)
  const removedPostsQuery = useMyRemovedPosts(activeUserId)
  const dismissed = use$(ephemeral$.reminderCardDismissed)

  // Seed the session bound ONCE, on the first hydrated+authenticated mount of
  // the session, and advance `repliesLastSeenAt` in the SAME step:
  //   (a) pin ONE `now`, used BOTH as the null-default for `since` AND as the
  //       advance value, so a first-ever open counts exactly zero;
  //   (b) capture `since := repliesLastSeenAt ?? now` (the PREVIOUS bound);
  //   (c) advance `repliesLastSeenAt := now` so the NEXT open counts only newer
  //       replies.
  // A later mount in the same session finds `reminderRepliesSince` already set
  // → it reuses that `since` and does NOT re-advance (the Home-bounce fix).
  useEffect(() => {
    if (activeUserId === null || !profileReady) return
    const seeded = ephemeral$.reminderRepliesSince.peek()
    if (seeded != null) {
      // Already seeded earlier this session (Home bounce) — reuse, never advance.
      setSince(seeded)
      return
    }
    const now = new Date().toISOString()
    const captured = getRepliesLastSeenAt() ?? now
    ephemeral$.reminderRepliesSince.set(captured)
    setSince(captured)
    markRepliesSeen(now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId, profileReady])

  if (activeUserId === null) return null

  // ── Streak pending ────────────────────────────────────────────────────────
  const streakPref = profile?.preferences?.reminders?.streak
  const streakEnabled = streakPref?.enabled === true
  const localTime = streakPref?.local_time ?? '20:00'
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const streakPending =
    streakEnabled && wordCount < DAILY_500 && currentMinutes >= minutesSinceMidnight(localTime)

  // ── Replies pending ───────────────────────────────────────────────────────
  const unreadCount = unreadReplies?.data
  const repliesPending = typeof unreadCount === 'number' && unreadCount > 0

  // ── Moderation pending (same signal ModerationReceiptGate reads) ──────────
  // Re-check `ends_at > now` at render — a suspension that lapsed mid-session
  // can still sit in the 60s-stale cache; it is not pending.
  const suspensionPending =
    suspension !== null &&
    new Date(suspension.ends_at).getTime() > Date.now() &&
    !hasAcknowledgedReceipt(suspensionReceiptId(suspension.id))
  const removedPosts = removedPostsQuery?.data ?? []
  const removedPending = removedPosts.some(
    (post) => !hasAcknowledgedReceipt(removedPostReceiptId(post.id, post.removed_at))
  )
  const moderationPending = suspensionPending || removedPending

  // Session dismissal, then the "nothing pending → no surface" rule (which
  // overrides the dismiss flag — there is simply nothing to show).
  if (dismissed) return null
  const anyPending = streakPending || repliesPending || moderationPending
  if (!anyPending) return null

  return (
    <YStack
      testID="in-app-reminder-card"
      gap="$2"
      marginHorizontal="$4"
      marginBottom="$4"
      padding="$4"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$color4"
      backgroundColor="$color2"
    >
      {streakPending && (
        <XStack
          testID="reminder-row-streak"
          cursor="pointer"
          onPress={() => router.push('/journal')}
          accessibilityRole="button"
          accessibilityLabel="Finish today's writing"
        >
          <Text
            fontFamily="$body"
            fontSize={15}
            color="$color12"
          >
            Finish today's writing
          </Text>
        </XStack>
      )}

      {repliesPending && (
        <XStack
          testID="reminder-row-replies"
          cursor="pointer"
          onPress={() => router.push('/collective')}
          accessibilityRole="button"
          accessibilityLabel="See new replies in the Collective"
        >
          <Text
            fontFamily="$body"
            fontSize={15}
            color="$color12"
          >
            You have new replies in the Collective
          </Text>
        </XStack>
      )}

      {moderationPending && (
        <XStack
          testID="reminder-row-moderation"
          cursor="pointer"
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Review a moderation update"
        >
          <Text
            fontFamily="$body"
            fontSize={15}
            color="$color12"
          >
            You have a moderation update to review
          </Text>
        </XStack>
      )}

      <Text
        testID="reminder-dismiss"
        cursor="pointer"
        onPress={() => ephemeral$.reminderCardDismissed.set(true)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss reminders"
        fontFamily="$body"
        fontSize={13}
        color="$color9"
        alignSelf="flex-end"
      >
        Dismiss
      </Text>
    </YStack>
  )
}

export default InAppReminderGate
