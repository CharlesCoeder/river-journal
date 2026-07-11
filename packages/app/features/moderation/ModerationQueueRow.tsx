// packages/app/features/moderation/ModerationQueueRow.tsx
//
// A single moderation-queue row: the reported post's title/body preview, the
// aggregated flag count, the anonymized author, the post timestamp, the latest
// report reason/note preview, an expand-to-show-all-reports toggle, and the
// action affordances. Reuses the Collective-feed styling (dense, no card
// borders); the row divider is drawn by the screen.
//
// Boundary rule (D7): no Legend-State imports in this file.
//
// Deletion-state rendering mirrors FeedPostRow / ThreadView / PostRow verbatim.
// Precedence: is_user_deleted (content self-delete) WINS when it co-occurs with
// author_user_id === null (account deletion) — render ONLY the self-deleted
// tombstone + "Author self-deleted" marker, never also "Author deleted account".
//
// Action affordances: Remove / Add note / Suspend author open their controlled
// dialogs (RemovePostDialog / AddNoteDialog / SuspendUserDialog). The three
// mutation hooks are hosted HERE at the row level (not inside the dialog
// children) so `isPending` survives a fire-and-forget dialog close (the
// double-submit guard). Each affordance's open state + target-id snapshot lives
// in a small co-located action component so opening/closing a dialog re-renders
// only that action, not the row (keeping the row-level hooks stable). The
// target id is snapshotted when the dialog OPENS so a concurrent queue refetch
// can't retarget Confirm at the wrong post/author. "Dismiss reports" is inert —
// deferred below.
//
// The row container is a non-interactive `role="article"` landmark; a dedicated
// button carries the expand toggle's `aria-expanded` semantics.

import { useRef, useState } from 'react'
import { View, Text, XStack, YStack, useToastController } from '@my/ui'
import type { ModerationQueueItem } from 'app/state/collective/moderation'
import {
  useRemovePost,
  useSuspendUser,
  useAddModerationNote,
} from 'app/state/collective/moderationMutations'
import { timeAgoCasual } from 'app/features/collective/_shared'
import { RemovePostDialog } from './RemovePostDialog'
import { SuspendUserDialog } from './SuspendUserDialog'
import { AddNoteDialog } from './AddNoteDialog'

// Body preview cap — never dump a full (up to 500-word) body into the row.
const BODY_PREVIEW_CAP = 240

export interface ModerationQueueRowProps {
  item: ModerationQueueItem
}

function truncateBody(body: string): string {
  if (body.length <= BODY_PREVIEW_CAP) return body
  return `${body.slice(0, BODY_PREVIEW_CAP).trimEnd()}…`
}

const stop = (e?: { stopPropagation?: () => void }) => e?.stopPropagation?.()

// ─── Co-located action components ───────────────────────────────────────────
// Each owns its dialog open state + a target-id snapshot captured at open time.
// The mutation is passed in from the row (hosted there so isPending survives a
// fire-and-forget close). Because open state lives here, opening/closing a
// dialog re-renders only the action, not the row.
//
// Focus-return fallback: each affordance keeps a ref to its trigger element and
// refocuses it whenever its dialog closes. The tamagui Dialog focus-trap already
// restores focus to the pre-open element, but the affordances are custom Views —
// this explicit `.focus()` guarantees Cancel/Esc lands focus back on the row
// affordance even if the primitive's auto-restore doesn't fire.

type RemoveMutation = ReturnType<typeof useRemovePost>
type NoteMutation = ReturnType<typeof useAddModerationNote>
type SuspendMutation = ReturnType<typeof useSuspendUser>

function RemoveAction({ postId, mutation }: { postId: string; mutation: RemoveMutation }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  // tamagui View forwards to the DOM node on web; typed `any` to match the
  // codebase's focus-ref pattern (see CelebrationScreen).
  const affordanceRef = useRef<any>(null)
  const toast = useToastController()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) affordanceRef.current?.focus?.()
  }

  // Removal is optimistic + fire-and-forget: the dialog closes on Confirm and the
  // row is patched immediately. A failed remove rolls the row back (mutation
  // layer) AND surfaces a calm toast here so the failure is never silent.
  const dialogMutation = {
    isPending: mutation.isPending,
    mutate: (vars: { target_post_id: string; reason_code: string; custom_note: string | null }) => {
      mutation.mutate(vars, {
        onError: () =>
          toast.show("Couldn't remove that post", {
            message: 'It has been restored. Try again.',
          }),
      })
    },
  }

  return (
    <>
      <View
        ref={affordanceRef}
        tag="button"
        data-testid="moderation-action-remove"
        cursor="pointer"
        onPress={(e) => {
          stop(e)
          setTarget(postId)
          setOpen(true)
        }}
      >
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color10"
        >
          Remove
        </Text>
      </View>
      <RemovePostDialog
        open={open}
        onOpenChange={handleOpenChange}
        postId={target ?? postId}
        mutation={dialogMutation}
      />
    </>
  )
}

function NoteAction({ postId, mutation }: { postId: string; mutation: NoteMutation }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  const affordanceRef = useRef<any>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) affordanceRef.current?.focus?.()
  }

  return (
    <>
      <View
        ref={affordanceRef}
        tag="button"
        data-testid="moderation-action-add-note"
        cursor="pointer"
        onPress={(e) => {
          stop(e)
          setTarget(postId)
          setOpen(true)
        }}
      >
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color10"
        >
          Add note
        </Text>
      </View>
      <AddNoteDialog
        open={open}
        onOpenChange={handleOpenChange}
        postId={target ?? postId}
        mutation={mutation}
      />
    </>
  )
}

function SuspendAction({
  authorUserId,
  mutation,
}: { authorUserId: string; mutation: SuspendMutation }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  const affordanceRef = useRef<any>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) affordanceRef.current?.focus?.()
  }

  return (
    <>
      <View
        ref={affordanceRef}
        tag="button"
        data-testid="moderation-action-suspend"
        cursor="pointer"
        onPress={(e) => {
          stop(e)
          setTarget(authorUserId)
          setOpen(true)
        }}
      >
        <Text
          fontFamily="$body"
          fontSize="$2"
          color="$color10"
        >
          Suspend author
        </Text>
      </View>
      <SuspendUserDialog
        open={open}
        onOpenChange={handleOpenChange}
        authorUserId={target ?? authorUserId}
        mutation={mutation}
      />
    </>
  )
}

export function ModerationQueueRow({ item }: ModerationQueueRowProps) {
  const [expanded, setExpanded] = useState(false)

  // Row-hosted mutation hooks — isPending survives fire-and-forget dialog close.
  const removeMutation = useRemovePost()
  const suspendMutation = useSuspendUser()
  const noteMutation = useAddModerationNote()

  // Deletion-state precedence: is_user_deleted wins when both coincide.
  const selfDeleted = item.is_user_deleted === true
  const accountDeleted = item.author_user_id === null

  // Author identity: the anonymized 8-char slice used across the Collective.
  const author = item.author_user_id?.slice(0, 8) ?? '[deleted]'

  // Body: self-deleted content is a tombstone; an account-deleted author keeps
  // the original body (only the account row is gone).
  const bodyText = selfDeleted ? '[deleted]' : truncateBody(item.body)

  const flagLabel = `${item.flag_count} report${item.flag_count === 1 ? '' : 's'}`

  const reports = item.reports ?? []

  return (
    <View
      tag="article"
      role="article"
      paddingVertical="$5"
      gap="$3"
    >
      {/* ─── Title + body preview ──────────────────────────────────────────── */}
      <YStack gap="$2">
        {item.title != null ? (
          <Text
            tag="h3"
            fontFamily="$journal"
            fontSize="$6"
            color="$color12"
            textDecorationLine={item.is_removed ? 'line-through' : 'none'}
            opacity={item.is_removed ? 0.5 : 1}
          >
            {item.title}
          </Text>
        ) : null}
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$color11"
          textDecorationLine={item.is_removed ? 'line-through' : 'none'}
          opacity={item.is_removed ? 0.5 : 1}
        >
          {bodyText}
        </Text>
      </YStack>

      {/* ─── Metadata line: author · time · flag count · markers ───────────── */}
      <XStack
        alignItems="center"
        gap="$3"
        flexWrap="wrap"
      >
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
          textTransform="uppercase"
          letterSpacing={1}
        >
          {author}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
        >
          {timeAgoCasual(item.post_created_at)}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color11"
          fontWeight="600"
        >
          {flagLabel}
        </Text>
        {item.is_removed ? (
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color9"
          >
            Removed
          </Text>
        ) : null}
        {selfDeleted ? (
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color9"
          >
            Author self-deleted
          </Text>
        ) : accountDeleted ? (
          <Text
            fontFamily="$body"
            fontSize="$1"
            color="$color9"
          >
            Author deleted account
          </Text>
        ) : null}
      </XStack>

      {/* ─── Latest-report preview (collapsed) ─────────────────────────────── */}
      <Text
        fontFamily="$body"
        fontSize="$2"
        color="$color10"
      >
        {item.latest_report_note != null
          ? `${item.latest_report_reason} · ${item.latest_report_note}`
          : item.latest_report_reason}
      </Text>

      {/* ─── Dedicated expand toggle (button semantics + aria-expanded) ─────── */}
      <View
        tag="button"
        role="button"
        data-testid="moderation-row-expand-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reports' : 'Show reports'}
        alignSelf="flex-start"
        cursor="pointer"
        onPress={(e) => {
          stop(e)
          setExpanded((v) => !v)
        }}
      >
        <Text
          fontFamily="$body"
          fontSize="$1"
          color="$color9"
        >
          {expanded ? 'Hide reports' : 'Show reports'}
        </Text>
      </View>

      {/* ─── Expanded: all individual pending reports ──────────────────────── */}
      {expanded ? (
        <YStack
          data-testid="moderation-row-reports"
          gap="$2"
          paddingLeft="$3"
        >
          {reports.map((r) => (
            <YStack
              key={r.id}
              gap="$1"
            >
              <XStack
                gap="$2"
                alignItems="center"
              >
                <Text
                  fontFamily="$body"
                  fontSize="$2"
                  color="$color11"
                >
                  {r.reason_code}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize="$1"
                  color="$color9"
                >
                  {timeAgoCasual(r.created_at)}
                </Text>
              </XStack>
              {r.note != null ? (
                <Text
                  fontFamily="$body"
                  fontSize="$2"
                  color="$color10"
                >
                  {r.note}
                </Text>
              ) : null}
            </YStack>
          ))}
        </YStack>
      ) : null}

      {/* ─── Action affordances ────────────────────────────────────────────── */}
      <XStack
        gap="$4"
        flexWrap="wrap"
      >
        <RemoveAction
          postId={item.post_id}
          mutation={removeMutation}
        />
        <NoteAction
          postId={item.post_id}
          mutation={noteMutation}
        />
        {/* Suspend is absent when there is no user to suspend (account-deleted). */}
        {item.author_user_id != null ? (
          <SuspendAction
            authorUserId={item.author_user_id}
            mutation={suspendMutation}
          />
        ) : null}
        {/* "Dismiss reports" is deferred: there is NO dismiss RPC (reports are
            resolved via remove_post, or dismissed by a future change). Inert
            stub — stopPropagation only, no handler. */}
        <View
          tag="button"
          data-testid="moderation-action-dismiss"
          onPress={stop}
          cursor="pointer"
        >
          <Text
            fontFamily="$body"
            fontSize="$2"
            color="$color10"
          >
            Dismiss reports
          </Text>
        </View>
      </XStack>
    </View>
  )
}

export default ModerationQueueRow
