// packages/app/utils/exportCollectivePosts.ts
//
// Client-side Collective post export: a PURE Markdown formatter over
// already-fetched rows plus a thin fetch → format → deliver orchestrator.
//
// Purity (mirrors `utils/exportJournal.ts`): the formatter functions import
// only types + `toExportBlob` — zero supabase / network / React / Legend-State
// imports — so they are unit-testable with fixture rows. The supabase-touching
// page-fetcher lives in `state/collective/exportPosts.ts` (the D7 boundary) and
// is INJECTED into `exportCollectivePosts`. `downloadExport` (a local Blob/DOM
// share helper, not a supabase/network call) is imported directly to deliver
// the file — the export trigger UI itself lives in Privacy Center, so this
// module stays UI-decoupled and callable as a plain async function.

import type { CollectiveExportRow } from 'app/state/collective/exportPosts'
import { downloadExport } from 'app/utils/downloadExport'
import { toExportBlob } from 'app/utils/exportBlob'

/** Exact calm copy shown when the user has no Collective posts to export. */
const EMPTY_STATE_MESSAGE = "You haven't posted in the Collective yet — nothing to export."

// ---------------------------------------------------------------------------
// Pure per-post section
// ---------------------------------------------------------------------------

/**
 * Format a single export row into one deterministic Markdown section.
 *
 * Renders a timestamp heading, metadata lines (post id; `parent_post_id` only
 * for replies; reaction + reply counts), the title (top-level posts only —
 * replies carry `title = null` by DB CHECK), then the body. Two additive
 * markers keep live-post output clean:
 *   - moderator-removed (`is_removed`): a `> Removed by moderator` line, with
 *     the reason / timestamp when present. The body is still included — this is
 *     the owner reading their OWN data (a deliberate departure from the
 *     receipt-only `collective_my_removed_posts` RPC, which withholds it).
 *   - self-deleted (`is_user_deleted`): the DB `[deleted]` body is surfaced
 *     as-is, plus a note carrying `user_deleted_at`.
 */
export function formatCollectivePost(row: CollectiveExportRow): string {
  const isReply = row.parent_post_id !== null
  const lines: string[] = []

  lines.push(`## ${row.created_at}`)
  lines.push('')
  lines.push(`- Post ID: ${row.id}`)
  if (isReply) {
    lines.push(`- Reply to: ${row.parent_post_id}`)
  }
  lines.push(`- Reactions: ${row.reaction_count}`)
  lines.push(`- Replies: ${row.descendant_count}`)

  if (row.is_removed) {
    const reason = row.removed_reason ? `: ${row.removed_reason}` : ''
    const when = row.removed_at ? ` (${row.removed_at})` : ''
    lines.push(`- > Removed by moderator${reason}${when}`)
  }
  if (row.is_user_deleted) {
    lines.push(`- > You deleted this post on ${row.user_deleted_at}`)
  }

  lines.push('')
  // Title only exists on top-level posts (the CHECK forbids a non-NULL title
  // on replies), so render it only when present.
  if (!isReply && row.title !== null) {
    lines.push(`### ${row.title}`)
    lines.push('')
  }
  lines.push(row.body)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Pure document (header/summary + sections)
// ---------------------------------------------------------------------------

/** Count top-level posts vs replies from `parent_post_id`. */
function splitTotals(rows: CollectiveExportRow[]): { totalPosts: number; totalReplies: number } {
  let totalPosts = 0
  for (const row of rows) {
    if (row.parent_post_id === null) totalPosts++
  }
  return { totalPosts, totalReplies: rows.length - totalPosts }
}

/**
 * Render the full export document: a calm header/summary block (export date +
 * totals) followed by every post section, sorted newest-first. An empty input
 * still produces a valid, non-empty document carrying the exact empty-state
 * copy. Deterministic for a given input.
 */
export function renderCollectivePostsMarkdown(
  rows: CollectiveExportRow[],
  { exportedAt }: { exportedAt: string }
): string {
  const { totalPosts, totalReplies } = splitTotals(rows)

  const header: string[] = [
    '# River Journal — Collective export',
    '',
    `Exported: ${exportedAt}`,
    '',
    `- Posts: ${totalPosts}`,
    `- Replies: ${totalReplies}`,
    '',
  ]

  if (rows.length === 0) {
    header.push(EMPTY_STATE_MESSAGE, '')
    return header.join('\n')
  }

  // Newest-first. ISO 8601 timestamps sort lexically == chronologically, with
  // `id` as a tiebreak so rows sharing a timestamp render in a stable, total
  // order (mirrors the RPC's `(created_at, id) DESC` keyset) — never an
  // arbitrary interleave.
  const sorted = [...rows].sort((a, b) => {
    const byTime = b.created_at.localeCompare(a.created_at)
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id)
  })
  const sections = sorted.map(formatCollectivePost)

  return `${header.join('\n')}\n${sections.join('\n\n---\n\n')}\n`
}

// ---------------------------------------------------------------------------
// Fetch → format → deliver orchestrator
// ---------------------------------------------------------------------------

/** Timezone-agnostic local `YYYY-MM-DD` day string (project filename convention). */
function localDayString(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface CollectiveExportResult {
  totalPosts: number
  totalReplies: number
}

/**
 * Export the caller's Collective posts: fetch every own-post row (calm
 * running-count progress), format them into one Markdown document, and deliver
 * it through the carryover `downloadExport` seam (web anchor / native share).
 * Returns the top-level-vs-reply totals.
 *
 * The page-fetcher is injected (`deps.fetchAllExportPosts`) so this module
 * never imports `supabase` — the state-layer boundary. Logging is
 * metadata-only: a single success line carries counts + duration; on failure
 * only `err.message` is logged before rethrowing so the caller can surface
 * calm copy. Post body / title never reach any log line.
 */
export async function exportCollectivePosts(deps: {
  fetchAllExportPosts: (onProgress?: (count: number) => void) => Promise<CollectiveExportRow[]>
  onProgress?: (count: number) => void
}): Promise<CollectiveExportResult> {
  const startedAt = Date.now()
  try {
    const rows = await deps.fetchAllExportPosts(deps.onProgress)

    const exportedAt = localDayString()
    const markdown = renderCollectivePostsMarkdown(rows, { exportedAt })
    const blob = toExportBlob(markdown, 'text/markdown')
    // 2-arg call only: `downloadExport.ts` (web) declares no `mimeType` param;
    // the Blob already carries `text/markdown` via `toExportBlob`.
    await downloadExport(blob, `river-journal-collective-export-${exportedAt}.md`)

    const { totalPosts, totalReplies } = splitTotals(rows)
    // Metadata-only: counts + duration. Never body / title / removed_reason.
    console.log(
      JSON.stringify({
        event: 'collective_export_complete',
        totalPosts,
        totalReplies,
        durationMs: Date.now() - startedAt,
      })
    )
    return { totalPosts, totalReplies }
  } catch (err) {
    // Log only the message — never the raw error object (which could, for some
    // error shapes, carry request payload fields into the log).
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ event: 'collective_export_failed', message }))
    throw err
  }
}
