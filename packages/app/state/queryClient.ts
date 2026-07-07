/**
 * Web/desktop entry point. Metro on native picks `queryClient.native.ts`
 * instead; both files re-export the shared singleton from
 * `queryClient.shared.ts` (which has no platform-suffixed sibling, so the
 * native variant can reach it without resolving back to itself).
 */

export { queryClient, dehydrateOptions, QUERY_PERSIST_KEY } from './queryClient.shared'
