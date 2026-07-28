/**
 * Red-phase tests for `utils/exportCollectivePosts.ts` — the Collective
 * post-export Markdown formatter plus its fetch -> format -> delivery
 * orchestrator.
 *
 * None of `../exportCollectivePosts` exists yet; every test below MUST fail
 * (module-resolution error) until the module is built, and pass afterward.
 *
 * Pinned contract (see the companion test report for the full table):
 *   - formatCollectivePost(row: CollectiveExportRow): string
 *   - renderCollectivePostsMarkdown(rows: CollectiveExportRow[], { exportedAt: string }): string
 *   - exportCollectivePosts(deps: {
 *       fetchAllExportPosts: (onProgress?: (count: number) => void) => Promise<CollectiveExportRow[]>
 *       onProgress?: (count: number) => void
 *     }): Promise<{ totalPosts: number; totalReplies: number }>
 *
 * `exportCollectivePosts` takes its page-fetcher INJECTED so this module
 * never imports `app/utils/supabase` (the D7 state-boundary split — the
 * supabase-touching fetcher lives in `state/collective/exportPosts.ts`), but
 * it DOES call `app/utils/downloadExport` directly to deliver the file —
 * that's not a supabase/network/React import, so it doesn't break the
 * formatter's "zero supabase/network/React imports" purity contract.
 * `downloadExport` is mocked below so no real DOM/anchor download is
 * attempted under Vitest, mirroring `ExportJournal.test.tsx`'s treatment of
 * the same seam.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CollectiveExportRow } from 'app/state/collective/exportPosts'

const mockDownloadExport = vi.fn().mockResolvedValue(undefined)
vi.mock('app/utils/downloadExport', () => ({
  downloadExport: (...args: unknown[]) => mockDownloadExport(...args),
}))

beforeEach(() => {
  mockDownloadExport.mockClear()
})

const EMPTY_STATE_MESSAGE = "You haven't posted in the Collective yet — nothing to export."

function makeRow(overrides: Partial<CollectiveExportRow> = {}): CollectiveExportRow {
  return {
    id: 'post-1',
    user_id: 'user-A',
    parent_post_id: null,
    title: 'A live post',
    body: 'Hello, Collective.',
    created_at: '2026-07-10T12:00:00.000Z',
    is_removed: false,
    is_user_deleted: false,
    user_deleted_at: null,
    removed_reason: null,
    removed_at: null,
    reaction_count: 3,
    descendant_count: 2,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// formatCollectivePost — pure per-post section
// ---------------------------------------------------------------------------

describe('formatCollectivePost', () => {
  it('renders id, created_at, title, body, reaction count, and reply count for a live top-level post', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({
      id: 'post-42',
      created_at: '2026-07-10T12:00:00.000Z',
      title: 'My favorite river',
      body: 'It runs quiet in July.',
      reaction_count: 5,
      descendant_count: 3,
    })
    const section = formatCollectivePost(row)

    expect(section).toContain('post-42')
    expect(section).toContain('2026-07-10T12:00:00.000Z')
    expect(section).toContain('My favorite river')
    expect(section).toContain('It runs quiet in July.')
    expect(section).toContain('5')
    expect(section).toContain('3')
  })

  it('renders parent_post_id for a reply (title stays null, per the DB CHECK)', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({
      id: 'reply-1',
      parent_post_id: 'post-42',
      title: null,
      body: 'Totally agree.',
    })
    const section = formatCollectivePost(row)

    expect(section).toContain('post-42')
    expect(section).toContain('Totally agree.')
  })

  it('omits any parent reference for a top-level post but includes it for a reply', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const topLevel = makeRow({ id: 'post-1', parent_post_id: null })
    const reply = makeRow({ id: 'post-1', parent_post_id: 'some-other-post', title: null })

    expect(formatCollectivePost(topLevel)).not.toContain('some-other-post')
    expect(formatCollectivePost(reply)).toContain('some-other-post')
  })

  it('marks a moderator-removed post with a clear moderation marker and still includes the body (the owner reading their own data)', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({
      is_removed: true,
      removed_reason: 'spam',
      removed_at: '2026-07-11T00:00:00.000Z',
      body: 'The original removed body text.',
    })
    const section = formatCollectivePost(row)

    expect(section).toContain('Removed by moderator')
    expect(section).toContain('The original removed body text.')
  })

  it('surfaces the removed_reason in the marker when present', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({ is_removed: true, removed_reason: 'harassment' })
    expect(formatCollectivePost(row)).toContain('harassment')
  })

  it('never renders the moderation marker for a live (non-removed) post', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({ is_removed: false })
    expect(formatCollectivePost(row)).not.toContain('Removed by moderator')
  })

  it('surfaces the DB [deleted] body marker plus the user_deleted_at value for a self-deleted post', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow({
      is_user_deleted: true,
      user_deleted_at: '2026-07-12T08:30:00.000Z',
      body: '[deleted]',
      title: '[deleted]',
    })
    const section = formatCollectivePost(row)

    expect(section).toContain('[deleted]')
    expect(section).toContain('2026-07-12T08:30:00.000Z')
  })

  it('renders additional (marker) content for a self-deleted post versus the same row without the flag', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const live = makeRow({ is_user_deleted: false, user_deleted_at: null, body: 'still here' })
    const deleted = makeRow({
      is_user_deleted: true,
      user_deleted_at: '2026-07-12T08:30:00.000Z',
      body: '[deleted]',
    })
    expect(formatCollectivePost(deleted).length).toBeGreaterThan(formatCollectivePost(live).length)
  })

  it('produces byte-identical output for the same row (deterministic)', async () => {
    const { formatCollectivePost } = await import('../exportCollectivePosts')
    const row = makeRow()
    expect(formatCollectivePost(row)).toBe(formatCollectivePost(row))
  })
})

// ---------------------------------------------------------------------------
// renderCollectivePostsMarkdown — header/summary + sections
// ---------------------------------------------------------------------------

describe('renderCollectivePostsMarkdown', () => {
  it('produces a valid, non-empty document carrying the exact calm empty-state string when there are zero posts', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const md = renderCollectivePostsMarkdown([], { exportedAt: '2026-07-15' })

    expect(md.length).toBeGreaterThan(0)
    expect(md).toContain(EMPTY_STATE_MESSAGE)
  })

  it('includes the export date in the header', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const md = renderCollectivePostsMarkdown([makeRow()], { exportedAt: '2026-07-15' })
    expect(md).toContain('2026-07-15')
  })

  it('reflects different totals in the header for different inputs (not a static/hardcoded header)', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const oneRow = [
      makeRow({ id: 'top-1', parent_post_id: null, created_at: '2026-07-10T12:00:00.000Z' }),
    ]
    const threeRows = [
      makeRow({ id: 'top-1', parent_post_id: null, created_at: '2026-07-10T12:00:00.000Z' }),
      makeRow({ id: 'top-2', parent_post_id: null, created_at: '2026-07-09T12:00:00.000Z' }),
      makeRow({
        id: 'reply-1',
        parent_post_id: 'top-1',
        title: null,
        created_at: '2026-07-08T12:00:00.000Z',
      }),
    ]
    const mdOne = renderCollectivePostsMarkdown(oneRow, { exportedAt: '2026-07-15' })
    const mdThree = renderCollectivePostsMarkdown(threeRows, { exportedAt: '2026-07-15' })

    // Newest-first sort puts 'top-1' first in both documents, so the text
    // BEFORE its first occurrence is the header/summary block -- it must
    // differ between the two inputs since the totals differ.
    const headerOne = mdOne.slice(0, mdOne.indexOf('top-1'))
    const headerThree = mdThree.slice(0, mdThree.indexOf('top-1'))
    expect(headerOne.length).toBeGreaterThan(0)
    expect(headerThree.length).toBeGreaterThan(0)
    expect(headerThree).not.toBe(headerOne)
  })

  it('sorts posts newest-first', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const older = makeRow({ id: 'older-post', created_at: '2026-07-01T00:00:00.000Z' })
    const newer = makeRow({ id: 'newer-post', created_at: '2026-07-10T00:00:00.000Z' })
    const md = renderCollectivePostsMarkdown([older, newer], { exportedAt: '2026-07-15' })

    expect(md.indexOf('newer-post')).toBeGreaterThanOrEqual(0)
    expect(md.indexOf('older-post')).toBeGreaterThan(md.indexOf('newer-post'))
  })

  it('orders rows that share an identical timestamp deterministically by id (stable total order, not an arbitrary interleave)', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const sameTime = '2026-07-10T00:00:00.000Z'
    const rowsAsc = [
      makeRow({ id: 'aaa', created_at: sameTime }),
      makeRow({ id: 'bbb', created_at: sameTime }),
      makeRow({ id: 'ccc', created_at: sameTime }),
    ]
    // Reversed input must yield the SAME rendered order — the sort is total,
    // not dependent on input order.
    const rowsDesc = [...rowsAsc].reverse()
    const mdAsc = renderCollectivePostsMarkdown(rowsAsc, { exportedAt: '2026-07-15' })
    const mdDesc = renderCollectivePostsMarkdown(rowsDesc, { exportedAt: '2026-07-15' })

    expect(mdAsc).toBe(mdDesc)
    // Tiebreak is id DESC (mirrors the RPC keyset): ccc, then bbb, then aaa.
    expect(mdAsc.indexOf('ccc')).toBeLessThan(mdAsc.indexOf('bbb'))
    expect(mdAsc.indexOf('bbb')).toBeLessThan(mdAsc.indexOf('aaa'))
  })

  it('includes every post section joined into the single document', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const rows = [
      makeRow({ id: 'post-a', created_at: '2026-07-10T00:00:00.000Z' }),
      makeRow({ id: 'post-b', created_at: '2026-07-09T00:00:00.000Z' }),
    ]
    const md = renderCollectivePostsMarkdown(rows, { exportedAt: '2026-07-15' })

    expect(md).toContain('post-a')
    expect(md).toContain('post-b')
  })

  it('produces byte-identical output for the same input (deterministic)', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const rows = [makeRow({ id: 'post-a' }), makeRow({ id: 'post-b' })]
    const first = renderCollectivePostsMarkdown(rows, { exportedAt: '2026-07-15' })
    const second = renderCollectivePostsMarkdown(rows, { exportedAt: '2026-07-15' })
    expect(first).toBe(second)
  })

  it('includes moderator-removed and self-deleted rows in the rendered document, not just live posts', async () => {
    const { renderCollectivePostsMarkdown } = await import('../exportCollectivePosts')
    const rows = [
      makeRow({ id: 'removed-post', is_removed: true, removed_reason: 'spam' }),
      makeRow({ id: 'deleted-post', is_user_deleted: true, body: '[deleted]' }),
    ]
    const md = renderCollectivePostsMarkdown(rows, { exportedAt: '2026-07-15' })

    expect(md).toContain('removed-post')
    expect(md).toContain('deleted-post')
    expect(md).toContain('Removed by moderator')
  })
})

// ---------------------------------------------------------------------------
// exportCollectivePosts — fetch -> format -> delivery orchestrator
// ---------------------------------------------------------------------------

describe('exportCollectivePosts (delivery/wiring orchestrator)', () => {
  it('calls the injected fetchAllExportPosts (never touches supabase directly) and returns totals split by top-level vs reply', async () => {
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const rows = [
      makeRow({ id: 'top-1', parent_post_id: null }),
      makeRow({ id: 'reply-1', parent_post_id: 'top-1', title: null }),
      makeRow({ id: 'reply-2', parent_post_id: 'top-1', title: null }),
    ]
    const fetchAllExportPosts = vi.fn().mockResolvedValue(rows)

    const result = await exportCollectivePosts({ fetchAllExportPosts })

    expect(fetchAllExportPosts).toHaveBeenCalledTimes(1)
    expect(result.totalPosts).toBe(1)
    expect(result.totalReplies).toBe(2)
  })

  it('forwards the caller-supplied onProgress to fetchAllExportPosts', async () => {
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const onProgress = vi.fn()
    const fetchAllExportPosts = vi.fn().mockResolvedValue([])

    await exportCollectivePosts({ fetchAllExportPosts, onProgress })

    expect(fetchAllExportPosts).toHaveBeenCalledWith(onProgress)
  })

  it('delivers the export via downloadExport with a river-journal-collective-export-YYYY-MM-DD.md filename and a text/markdown Blob', async () => {
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const fetchAllExportPosts = vi.fn().mockResolvedValue([makeRow()])

    await exportCollectivePosts({ fetchAllExportPosts })

    expect(mockDownloadExport).toHaveBeenCalledTimes(1)
    const [blob, filename] = mockDownloadExport.mock.calls[0]!
    expect(filename).toMatch(/^river-journal-collective-export-\d{4}-\d{2}-\d{2}\.md$/)
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as Blob).type).toBe('text/markdown')
  })

  it('calls downloadExport with exactly 2 arguments (blob, filename) — no third mimeType argument on the web seam', async () => {
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const fetchAllExportPosts = vi.fn().mockResolvedValue([])

    await exportCollectivePosts({ fetchAllExportPosts })

    expect(mockDownloadExport.mock.calls[0]).toHaveLength(2)
  })

  it('produces a delivered blob carrying the exact calm empty-state string when there are zero posts, and returns zero totals', async () => {
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const fetchAllExportPosts = vi.fn().mockResolvedValue([])

    const result = await exportCollectivePosts({ fetchAllExportPosts })
    const [blob] = mockDownloadExport.mock.calls[0]!
    const text = await (blob as Blob).text()

    expect(text).toContain(EMPTY_STATE_MESSAGE)
    expect(result.totalPosts).toBe(0)
    expect(result.totalReplies).toBe(0)
  })

  it('logs a metadata-only success line (posts/replies counts + duration) and never logs post body or title', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const secretBody = 'this body text must never appear in any log line'
    const rows = [makeRow({ body: secretBody, title: 'a secret title' })]
    const fetchAllExportPosts = vi.fn().mockResolvedValue(rows)

    await exportCollectivePosts({ fetchAllExportPosts })

    expect(logSpy).toHaveBeenCalled()
    const loggedText = logSpy.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(loggedText).not.toContain(secretBody)
    expect(loggedText).not.toContain('a secret title')
    logSpy.mockRestore()
  })

  it('on failure, logs only err.message (never the raw error/body/title) and rethrows so the caller can surface calm copy', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const fetchAllExportPosts = vi.fn().mockRejectedValue(new Error('boom: network unreachable'))

    await expect(exportCollectivePosts({ fetchAllExportPosts })).rejects.toThrow(
      'boom: network unreachable'
    )
    expect(errorSpy).toHaveBeenCalled()
    const loggedText = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(loggedText).toContain('boom: network unreachable')
    errorSpy.mockRestore()
  })

  it('does not call downloadExport when the fetch fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { exportCollectivePosts } = await import('../exportCollectivePosts')
    const fetchAllExportPosts = vi.fn().mockRejectedValue(new Error('fetch failed'))

    await expect(exportCollectivePosts({ fetchAllExportPosts })).rejects.toThrow()
    expect(mockDownloadExport).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
