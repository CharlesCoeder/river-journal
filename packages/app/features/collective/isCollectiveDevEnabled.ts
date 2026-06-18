/**
 * Dev access flag for the Collective.
 *
 * The public `/collective` route currently shows a placeholder while the real
 * feed is restyled. Developers can always reach the real feed by typing the
 * `/collective/dev` route directly (built into every build, env-independent).
 *
 * This flag only controls the *convenience link* surfaced on the home screen,
 * so the dev entrypoint stays discoverable on dev builds without exposing it to
 * the public on production auto-builds. Mirrors the sync dev-flag pattern in
 * packages/app/state/initializeApp.ts.
 *
 * Enable by adding to your env:
 *   NEXT_PUBLIC_COLLECTIVE_DEV=true   (web / desktop)
 *   EXPO_PUBLIC_COLLECTIVE_DEV=true   (mobile)
 */
export function isCollectiveDevEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_COLLECTIVE_DEV === 'true' ||
    process.env.EXPO_PUBLIC_COLLECTIVE_DEV === 'true'
  )
}

/** Route to the always-available developer view of the real Collective feed. */
export const COLLECTIVE_DEV_ROUTE = '/collective/dev'
