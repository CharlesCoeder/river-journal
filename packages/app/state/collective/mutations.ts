// packages/app/state/collective/mutations.ts
//
// EAGER-IMPORT ORDERING (the #1 documented TanStack Query persistence footgun):
// This file is imported BEFORE <PersistQueryClientProvider> mounts so that
// setMutationDefaults() calls register at module-load time. If the provider
// mounts first and resumes a persisted mutation whose mutationKey has no
// registered defaults, the replay silently no-ops.
//
// This file currently only reserves the import path. A follow-up will fill in
// the actual setMutationDefaults() registrations for ['collective','post'],
// ['collective','react'], ['collective','report'], and ['collective','delete_own'].
//
// Boundary rule (D7): this file MUST NOT import the Legend-State package.
//
// TODO: replace this stub with real registrations when mutation surfaces land.

// Sentinel side-effect so the module is not tree-shaken away by bundlers
// that aggressively prune side-effect-free files. Real top-level statements
// in a follow-up will make this redundant.
export const __collectiveMutationsStub = true

// Module-load timestamp captured exactly once at first import. The provider
// reads this in dev to verify the eager-import ordering held — if it didn't,
// the provider closure runs before this number is populated and a
// console.warn fires.
export const __collectiveMutationsLoadedAt: number = Date.now()
