/**
 * TanStack Query singleton + dehydration policy (web/desktop variant).
 *
 * Module-level singleton — NOT a factory — so `setMutationDefaults` calls
 * elsewhere can register against the same instance at module-load time
 * (the eager-import discipline depends on a stable import target).
 *
 * Boundary rule (D7): this file MUST NOT import the Legend-State package.
 */

import { QueryClient, type DehydrateOptions, type DefaultOptions } from '@tanstack/react-query'

const defaultOptions: DefaultOptions = {
  queries: {
    retry: 2,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30_000),
  },
  mutations: {
    retry: 0,
  },
}

export const queryClient = new QueryClient({ defaultOptions })

// Mutation keys whose IN-FLIGHT state we persist (TanStack Query Issue #7044
// workaround) so an app crash mid-submit doesn't drop the user's content.
// Reactions are intentionally excluded — they're user-recoverable (re-tap).
const PERSIST_IN_FLIGHT_KEYS = new Set(['collective.post', 'collective.report'])

export const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateMutation: (mutation) => {
    const key = mutation.options.mutationKey?.join('.') ?? ''
    // Default behavior: persist paused mutations (offline-queued).
    if (mutation.state.isPaused) return true
    // Override: ALSO persist in-flight 'collective.post' / 'collective.report'
    // so an app crash mid-submit doesn't drop the user's content.
    // See: https://github.com/TanStack/query/issues/7044
    if (PERSIST_IN_FLIGHT_KEYS.has(key) && mutation.state.status === 'pending') return true
    return false
  },
}
