/**
 * ExportCollectivePosts — the Collective-posts data-rights export entry point.
 *
 * A prop-less, self-contained component (mirrors `ExportJournal`'s shape) that
 * wires the shared `exportCollectivePosts` orchestrator to the real
 * `fetchAllExportPosts` page-fetcher and surfaces a calm `idle → exporting →
 * done | error` machine. The orchestrator owns fetching, formatting, AND
 * delivery (filename + download) — this component never calls `downloadExport`
 * itself; it only drives progress/result UI.
 *
 * Progress is a calm RUNNING COUNT (total is unknown until pagination finishes),
 * text only — never a spinner (product-wide rule). Retry re-invokes the
 * orchestrator, which re-runs pagination from the first page, so the running
 * count resets to 0 (there is no partial resume).
 *
 * Rendered only for an authenticated session — the export RPC is
 * `auth.uid()`-scoped, so an anonymous/local-only user has no Collective posts
 * to export and the component self-nulls.
 */

import { useCallback, useRef, useState } from 'react'
import { Text, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { exportCollectivePosts } from 'app/utils/exportCollectivePosts'
import { fetchAllExportPosts } from 'app/state/collective/exportPosts'

type ExportState = 'idle' | 'exporting' | 'done' | 'error'

interface ExportResult {
  totalPosts: number
  totalReplies: number
}

export function ExportCollectivePosts() {
  const isAuthenticated = use$(store$.session.isAuthenticated)

  const [state, setState] = useState<ExportState>('idle')
  const [count, setCount] = useState(0)
  const [result, setResult] = useState<ExportResult | null>(null)
  const exportingRef = useRef(false)

  const runExport = useCallback(async () => {
    if (exportingRef.current) return
    exportingRef.current = true
    // Fresh run: pagination restarts from page 1, so the running count resets.
    setCount(0)
    setState('exporting')
    const startedAt = Date.now()
    try {
      const totals = await exportCollectivePosts({
        fetchAllExportPosts,
        onProgress: (n: number) => setCount(n),
      })
      setResult(totals)
      // Metadata-only: outcome + duration. The orchestrator already logs counts.
      console.log('[ExportCollectivePosts] export complete', {
        durationMs: Date.now() - startedAt,
      })
      setState('done')
    } catch (err) {
      // Only the message — never the raw error object, so no post body/title can
      // smuggle into a log line.
      console.error(
        '[ExportCollectivePosts] export failed:',
        err instanceof Error ? err.message : 'unknown error'
      )
      setState('error')
    } finally {
      exportingRef.current = false
    }
  }, [])

  if (!isAuthenticated) return null

  if (state === 'exporting') {
    return (
      <YStack gap="$2">
        <Text
          fontFamily="$journal"
          fontSize={20}
          color="$color"
        >
          Export Collective Posts
        </Text>
        <Text
          testID="export-collective-progress"
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          {`Exporting your Collective posts… ${count} so far`}
        </Text>
      </YStack>
    )
  }

  if (state === 'error') {
    return (
      <YStack gap="$2">
        <Text
          fontFamily="$journal"
          fontSize={20}
          color="$color"
        >
          Export Collective Posts
        </Text>
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          Something went wrong while preparing your export.
        </Text>
        <Text
          testID="export-collective-retry"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={2}
          textTransform="uppercase"
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={runExport}
        >
          Try Again
        </Text>
      </YStack>
    )
  }

  if (state === 'done' && result) {
    const postWord = result.totalPosts === 1 ? 'post' : 'posts'
    const replyWord = result.totalReplies === 1 ? 'reply' : 'replies'
    return (
      <YStack gap="$2">
        <Text
          fontFamily="$journal"
          fontSize={20}
          color="$color"
        >
          Export Collective Posts
        </Text>
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          {`Exported ${result.totalPosts} ${postWord} and ${result.totalReplies} ${replyWord}.`}
        </Text>
        <Text
          testID="export-collective-done-reset"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={2}
          textTransform="uppercase"
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={() => setState('idle')}
        >
          Export Again
        </Text>
      </YStack>
    )
  }

  // Idle — the entry point.
  return (
    <YStack gap="$2">
      <Text
        testID="export-collective-open"
        fontFamily="$journal"
        fontSize={20}
        color="$color"
        cursor="pointer"
        hoverStyle={{ opacity: 0.7 }}
        onPress={runExport}
      >
        Export Collective Posts
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$color8"
      >
        Download your Collective posts and replies as a Markdown file.
      </Text>
    </YStack>
  )
}
