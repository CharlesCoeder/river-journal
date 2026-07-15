/**
 * Internal-invariant test for the export page size.
 *
 * `fetchExportPostsPage` requests `PAGE_SIZE + 1` rows (the look-ahead idiom
 * that detects "has more" without a count query). The `collective_export_page`
 * RPC clamps `page_size` to a hard ceiling of 50. If `PAGE_SIZE + 1` ever
 * exceeded that ceiling, the server would silently drop the extra look-ahead
 * row, `hasMore` could never become true, and a large history would be
 * truncated to a single page. This asserts the invariant that keeps the
 * pagination loop correct end-to-end.
 */

import { describe, expect, it } from 'vitest'

// The RPC's server-side page_size ceiling (mirrors the SQL clamp
// `GREATEST(LEAST(COALESCE(page_size, 20), 50), 1)`).
const RPC_PAGE_SIZE_CEILING = 50

describe('export PAGE_SIZE look-ahead invariant', () => {
  it('keeps PAGE_SIZE + 1 within the RPC page_size ceiling so the look-ahead row is never clamped away', async () => {
    const { PAGE_SIZE } = await import('../exportPosts')
    expect(PAGE_SIZE + 1).toBeLessThanOrEqual(RPC_PAGE_SIZE_CEILING)
  })
})
