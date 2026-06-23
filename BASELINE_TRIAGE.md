# Baseline Failure Triage — river-journal `main`

> **Status:** Investigation complete (read-only). No source was modified.
> **Purpose:** Hand-off context for an AI agent to fix the pre-existing baseline failures in a new session.
> **Scope:** On a clean `main`, the repo is NOT green — ~115–117 failing tests across ~9–10 files, and ~2064 `error TS` lines. These pre-date current work and block using "green" as a regression signal.

---

## ⚠️ Read this before you touch anything

1. **The build-smoke tests mutate source.** `apps/web/__tests__/build.test.ts` and `apps/desktop/__tests__/build.test.ts` shell out to `tamagui build … ../../packages/app -- next build`, which runs Tamagui **static extraction that rewrites `packages/app/**/*.tsx` in place** (observed in `packages/app/features/auth/components/*.tsx`). **Do NOT run them while you have uncommitted work** — they corrupt diffs/stash. Run specific files instead, e.g. `yarn vitest run <path>`.
2. **The "2064 tsc lines" is inflated ~2×.** `apps/web` and `apps/desktop` re-typecheck the *same* `packages/app` source (plus a `node_modules/app` symlink alias). De-duplicated: **~1038 distinct errors**.
3. **Run-to-run flakiness is real** and is caused by an async unhandled rejection (IndexedDB) landing in unrelated test files — see fix #3. Stabilize that before trusting any pass count.
4. **No genuine product bugs were found.** Every failure is a stale test, mock/fixture drift from story 3‑15, an env-gating gap, or a types-resolution/tooling issue. The only source line worth defensively hardening is the unguarded `PostRow.tsx:39` `.slice`.

---

## Cluster table

| Cluster | Category | Root cause (file:line) | # failures | Confidence | Effort |
|---|---|---|---|---|---|
| ThreadView.test.tsx | test-bug | Component imports `useRouter` from `solito/navigation` (`ThreadView.tsx:31`); test mocks it on `solito/router` and gives `solito/navigation` only `useSearchParams` (`ThreadView.test.tsx:161-170`) | 43/44 | High | ~5 min |
| CollectiveFeedScreen.test.tsx | test-bug (stale fixture) | `makePost` factory emits `body`, not `excerpt`; `PostRow.tsx:39` does unguarded `post.excerpt.slice(0,80)` → `undefined.slice` (`test:299-322`) | 59/88 | High | ~10 min |
| YourPostsScreen.test.tsx | test-bug | Same class as ThreadView: mocks `useRouter` on `solito/router`, source uses `solito/navigation` (`YourPostsScreen.tsx:33`, `test:101-103`) | 5/55 | High | ~5 min |
| PostComposer.test.tsx | test-bug | Over-broad source-scan regex trips on a *comment* referencing `PersistentEditor` (`PostComposer.tsx:263`, `test:1092`); invariant not actually violated | 1/67 | High | trivial |
| AuthorByline.test.tsx | test-bug | `@my/ui` mock forwards only RN a11y props (`accessibilityLabel/Role`); component uses web props `aria-label`/`role` and mock never spreads `...rest` (`test:62-69` vs `AuthorByline.tsx:80-84`) | 3/24 | High | ~10 min |
| mutations.test.ts | test-bug | Greps stale path `queryClient.ts` (now a 9-line re-export); real consts moved to `queryClient.shared.ts:28` (`test:69,285`) | 1 | High | ~5 min |
| provider-wiring.test.ts | test-bug | Brittle regex demands `=== 'development'` immediately before `<ReactQueryDevtools`; real source correct but has `isWeb &&` + newline (`provider/index.tsx:166`, `test:111`) | 1 | High | ~5 min |
| queryClient.test.ts (IndexedDB) | **env/config** | Legend-State `observablePersistIndexedDB` singleton built at import time (`persistConfig.ts:35`), activated by top-level `syncedSupabase` wraps in `entries.ts`/`flows.ts`/`grace_days.ts`; `loadTable` throws when no `indexedDB`. No `@vitest-environment` set → node; happy-dom also lacks `indexedDB` | **suite-wide flakiness** | High | ~30 min |
| build.test.ts (web + desktop) | **tooling side-effect** | `tamagui build … ../../packages/app` extraction rewrites `packages/app/**/*.tsx`; no `disableExtraction`. Default `vitest run` picks them up — `exclude` only matches `*.config.*`, not `build.test.ts` (`vitest.config.mts:61-67`) | working-tree pollution | High | ~15 min |
| tsc TS2786 (772 lines) | **env/config** | Duplicate `@types/react`: root `19.1.17` vs `packages/app/node_modules/@types/react 19.0.14`, with `preserveSymlinks:true` → two `ReactElement` identities. No `resolutions` pin | ~74% of tsc | High | ~15 min |
| tsc `flow` unknown (TS18046, ~16) | source-bug | Circular type: `flows$` references `flows$.peek()` in its own initializer (`flows.ts:29,53,62,73`) → typed `any` → `Object.entries(...)` yields `unknown` `flow` across `store.ts` | ~16 | High | ~20 min |
| tsc test drift (TS2554 56 + TS2578 33) | source-bug | Mutation signature gained a required 2nd arg, tests not updated (`state/__tests__/mutations.test.ts`, `state/collective/__tests__/mutations.test.ts`); stale `@ts-expect-error` in `store.test.ts` | 89 | High | ~20 min |
| tsc persistConfig (TS4104) | source-bug | `TABLE_NAMES` is `as const` readonly tuple passed to mutable `string[]` param (`persistConfig.ts:25,38`) | 1 | High | trivial |
| tsc theme union (TS2322) | source-bug | `getCurrentTheme(): ThemeName` returns `themeName` typed `ThemeName \| 'custom'`; `'custom'` not in `ThemeName` (`store.ts:1228`, `types.ts:40,97`) | 1 (+~30 mixed TS2322) | High/Med | ~10 min |

---

## Top 5 highest-leverage fixes (do these first)

1. **Dedupe `@types/react` (one `resolutions` pin in root `package.json`).** Clears ~772 of ~1038 tsc errors. Pure env fix, no source touched. *Highest ROI, lowest risk.*
2. **Add `excerpt` to the `CollectiveFeedScreen` `makePost` fixture.** Clears 59 test failures. Optionally also harden `PostRow.tsx:39` → `post.excerpt?.slice(...) ?? ''` if `excerpt` can be absent at runtime.
3. **Gate Legend-State IndexedDB persistence in the test env.** Kills the unhandled rejection that drives run-to-run flakiness — stabilizes the *entire* suite. (Options below.)
4. **Fix the `solito/navigation` mock target in ThreadView + YourPostsScreen tests.** Same recipe both files; clears 43 + 5 = 48 failures. Mock `useRouter` on `solito/navigation` (and drop the stray `solito/router` mock).
5. **Fix `flows.ts:29` circular type + update the two mutation test files.** Clears the `flow`-unknown cascade (~16) plus ~56 TS2554 drift errors.

---

## Two structural decisions

**(a) Build-smoke tests should NOT run under `yarn test`.**
They run a real `next build` (180 s timeout each) and rewrite tracked `packages/app/**/*.tsx` via extraction (no `disableExtraction`). They're swept in only because root `vitest.config.mts` has no `include`/`projects` and `exclude` (`:61-67`) matches `*.config.*`, not `build.test.ts`.
→ Add `'**/build.test.ts'` to `test.exclude`; run them CI-only / on demand (consider renaming to `build.smoke.ts` or gating behind an env flag).

**(b) Gate legend-state IndexedDB in tests.**
Root throw: `@legendapp/state/persist-plugins/indexeddb` — `initialize()` early-returns without setting `this.db` when `indexedDB` is undefined, but `loadTable` still runs and throws. Activated at *import time* by top-level `syncedSupabase` wraps. (Your own `queryStorage.ts:23-25` already gates via `hasIndexedDB()` — only the Legend-State plugin is ungated.)
Options, preferred order:
- **(a) Alias the plugin to a no-op in `vitest.config.mts`** (same pattern as existing react-native-svg/netinfo stubs) — cleanest, kills it suite-wide. **Recommended.**
- (b) Environment-gated plugin swap in `persistConfig.ts` (`typeof indexedDB === 'undefined'` → in-memory/no-op).
- (c) `fake-indexeddb` in setup — heaviest.
- (d) Swallow the rejection — masks, don't.

---

## Quick wins vs deep

**Quick wins (mechanical, isolated, ~5–15 min, each clears a cluster):**
- `excerpt` in `makePost` (59 tests)
- solito mock target in ThreadView + YourPostsScreen (48 tests)
- `@types/react` resolutions pin (~772 tsc lines) — highest ROI
- PostComposer regex, provider-wiring regex, mutations.test path, AuthorByline mock (6 tests)
- `persistConfig.ts` `as const`, theme-union return type (2 tsc)
- Exclude `build.test.ts` from default run

**Deep (need design judgment / cross-cutting):**
- Legend-State IndexedDB gating strategy — pick aliasing vs source-gate; verify it doesn't mask real persistence wiring in tests that *do* exercise sync.
- `flows.ts:29` circular type — explicit annotation that breaks the self-reference without regressing synced-supabase typing; cascades into `store.ts`.
- Mutation-signature test drift (TS2554) — confirm the impl's new required 2nd arg is intended before mechanically updating 56 call sites.
- ~30 mixed TS2322 in `@my/ui` — partly downstream of the `@types/react` dedupe; **re-measure after fix #1 before touching them.**

---

## Suggested sequencing

1. Land fix #1 (`@types/react` dedupe), re-run tsc, *then* triage the TS2322 tail.
2. Land the IndexedDB gate (fix #3) before trusting any "green" signal.
3. Exclude `build.test.ts` from the default run so diffs stop getting polluted.
4. Sweep the test-bug quick wins (#2, #4, and the 6 small ones).
5. Tackle the deep source-type items (`flows.ts`, mutation drift) last.

## How to reproduce (safe, read-only)

```sh
# Single test file (safe):
yarn vitest run packages/app/features/collective/__tests__/ThreadView.test.tsx

# Per-workspace typecheck:
node_modules/.bin/tsc -p packages/app/tsconfig.json --noEmit

# DO NOT run while you have uncommitted work:
#   apps/web/__tests__/build.test.ts
#   apps/desktop/__tests__/build.test.ts
```

## Key evidence files
- `packages/app/node_modules/@types/react/package.json` (19.0.14) vs `node_modules/@types/react/package.json` (19.1.17)
- `tsconfig.base.json` (`preserveSymlinks`, `skipLibCheck`)
- `packages/app/state/flows.ts:29` · `store.ts:209,218,1228` · `persistConfig.ts:25,35,38` · `types.ts:40,97`
- `packages/app/state/entries.ts:101-105` (+ `flows.ts:117`, `grace_days.ts:58`) · `store.ts:23-25` · `collective/feed.ts:32`
- `vitest.config.mts:61-67` (no `environment`, exclude globs)
- `packages/app/features/collective/PostRow.tsx:39`
- `node_modules/@legendapp/state/persist-plugins/indexeddb.js:24,71-74`
