import type { Flow } from 'app/state/types'

/**
 * Joins a day's flows chronologically with double-newline separators for
 * display in the read-only reader. Pure and dependency-free so it can be shared
 * by every surface that opens a day read-only (the calendar reader and the
 * search results) without pulling in the heavy Editor module.
 *
 * Uses `.getTime()` for the Date subtraction to satisfy TypeScript.
 */
export function joinFlowsForReader(flows: Flow[]): string {
  if (flows.length === 0) return ''
  return [...flows]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((f) => f.content)
    .join('\n\n')
}
