/**
 * eventAllowlistServerParity.test.ts — TDD RED-PHASE guard against the
 * client `eventAllowlist.ts` and the server (Deno/Edge) mirror
 * `supabase/functions/_shared/eventAllowlist.ts` ever silently diverging.
 *
 * WHY THIS LIVES IN VITEST, NOT DENO (documented placement decision, per the
 * story's own guidance): both files are dependency-free (no SDK, no
 * platform-only imports, no `Deno.*` globals), so both are importable from
 * plain Node/Vitest. `vitest.config.mts` excludes `**\/supabase/functions/**`
 * from Vitest's TEST-COLLECTION glob only — that exclude does not stop a test
 * file living OUTSIDE that tree from `import`-ing a module that happens to
 * live inside it (the same nuance `scripts/__tests__/lint-edge-function-logging.e2e.test.ts`
 * documents for the sibling `contentKeys.ts` mirror pair). Importing the
 * server file by its literal `.ts` path from here is simpler than the reverse
 * (Deno cannot resolve into `packages/app` at all — that is the entire reason
 * the mirror exists), so the comparison is a single Vitest file, not a Deno
 * one.
 *
 * RED PHASE: `supabase/functions/_shared/eventAllowlist.ts` does not exist
 * yet, so the top-level import below fails module resolution and every test
 * in this file fails before a single assertion runs — the same
 * whole-file-red shape used throughout this repo's Deno red-phase specs.
 */

import { describe, expect, it } from 'vitest'
import { EVENT_ALLOWLIST as CLIENT_EVENT_ALLOWLIST } from '../eventAllowlist'
// The server mirror, imported by its literal path from outside the
// supabase/functions/** tree Vitest excludes from test COLLECTION (this file
// itself is not under that tree, so it is collected; the import target being
// under that tree is irrelevant to module resolution).
import { EVENT_ALLOWLIST as SERVER_EVENT_ALLOWLIST } from '../../../../../supabase/functions/_shared/eventAllowlist.ts'

describe('client <-> server EVENT_ALLOWLIST parity (drift guard)', () => {
  it('exposes the exact same set of event names', () => {
    const clientNames = Object.keys(CLIENT_EVENT_ALLOWLIST).sort()
    const serverNames = Object.keys(SERVER_EVENT_ALLOWLIST).sort()
    expect(serverNames).toEqual(clientNames)
  })

  it('every event exposes the exact same permitted prop keys on both mirrors', () => {
    const mismatches: Array<{ event: string; client: string[]; server: string[] }> = []
    for (const event of Object.keys(CLIENT_EVENT_ALLOWLIST)) {
      const clientProps = [
        ...(CLIENT_EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)[event].props,
      ].sort()
      const serverEntry = (
        SERVER_EVENT_ALLOWLIST as Record<string, { props: readonly string[] } | undefined>
      )[event]
      const serverProps = [...(serverEntry?.props ?? [])].sort()
      if (JSON.stringify(clientProps) !== JSON.stringify(serverProps)) {
        mismatches.push({ event, client: clientProps, server: serverProps })
      }
    }
    expect(mismatches).toEqual([])
  })

  it('the two maps are deep-equal (event names + prop lists), the mechanically-checked form of "never silently diverge"', () => {
    // Compare by (event -> sorted props) shape rather than raw deep-equal on
    // the whole entry, so an incidental description-string wording difference
    // between the two hand-maintained files is not itself a false-positive
    // drift failure — only the event SHAPE (name + permitted prop keys, the
    // part every consumer's correctness depends on) is required to match.
    const shapeOf = (allowlist: Record<string, { props: readonly string[] }>) => {
      const shape: Record<string, string[]> = {}
      for (const [event, entry] of Object.entries(allowlist)) {
        shape[event] = [...entry.props].sort()
      }
      return shape
    }
    expect(shapeOf(SERVER_EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)).toEqual(
      shapeOf(CLIENT_EVENT_ALLOWLIST as Record<string, { props: readonly string[] }>)
    )
  })

  it('collective_reply_delivered and moderation_notification_delivered (the two events this story adds) are present and identical on both mirrors', () => {
    for (const event of ['collective_reply_delivered', 'moderation_notification_delivered']) {
      const clientEntry = (
        CLIENT_EVENT_ALLOWLIST as Record<string, { props: readonly string[] } | undefined>
      )[event]
      const serverEntry = (
        SERVER_EVENT_ALLOWLIST as Record<string, { props: readonly string[] } | undefined>
      )[event]
      expect(clientEntry, `client allowlist is missing "${event}"`).toBeDefined()
      expect(serverEntry, `server mirror is missing "${event}"`).toBeDefined()
      expect([...(serverEntry?.props ?? [])].sort()).toEqual([...(clientEntry?.props ?? [])].sort())
    }
  })
})
