/**
 * Story 3-2 — TDD red-phase tests for provider wiring (AC #7, #10, #19).
 *
 * Source-level integration assertions on packages/app/provider/index.tsx that
 * cover wiring concerns we don't want to require a full React render to test:
 *   - <PersistQueryClientProvider> wraps <ToastProvider> (AC #7).
 *   - The persister is created with `retry: removeOldestQuery` (AC #19).
 *   - The persister key is `'rj-tq-cache'` (AC #7).
 *   - DevTools mount is gated on process.env.NODE_ENV === 'development' (AC #10).
 *   - The dev-only ordering guard reads __collectiveMutationsLoadedAt (AC #18).
 *   - onSuccess invokes queryClient.resumePausedMutations() (AC #7).
 *
 * Rationale: the story explicitly says "Do NOT test that
 * <PersistQueryClientProvider> renders correctly" (it would establish a heavy
 * provider-level rendering precedent). Source-level grep + AST-light text
 * assertions are the durable substitute, and they catch the exact regressions
 * the elicitation pre-mortem flagged (auto-formatter re-sorting imports,
 * future refactor dropping the dev guard, etc.).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PROVIDER_PATH = path.resolve(__dirname, '../../provider/index.tsx')

function providerSrc(): string {
  return readFileSync(PROVIDER_PATH, 'utf8')
}

describe('Story 3-2 / Provider PersistQueryClientProvider wiring (AC #7)', () => {
  it('imports PersistQueryClientProvider from @tanstack/react-query-persist-client', () => {
    const src = providerSrc()
    expect(src).toMatch(
      /import\s*\{[^}]*PersistQueryClientProvider[^}]*\}\s*from\s*['"]@tanstack\/react-query-persist-client['"]/
    )
  })

  it('imports createAsyncStoragePersister and removeOldestQuery (AC #19)', () => {
    const src = providerSrc()
    expect(src).toMatch(/createAsyncStoragePersister/)
    expect(src).toMatch(/removeOldestQuery/)
  })

  it('imports queryClient, dehydrateOptions from app/state/queryClient', () => {
    const src = providerSrc()
    expect(src).toMatch(
      /import\s*\{[^}]*queryClient[^}]*\}\s*from\s*['"]app\/state\/queryClient['"]/
    )
    expect(src).toMatch(
      /import\s*\{[^}]*dehydrateOptions[^}]*\}\s*from\s*['"]app\/state\/queryClient['"]/
    )
  })

  it('imports queryStorage from app/state/queryStorage', () => {
    const src = providerSrc()
    expect(src).toMatch(/import\s*\{[^}]*queryStorage[^}]*\}\s*from\s*['"]app\/state\/queryStorage['"]/)
  })

  it('configures the persister with key "rj-tq-cache" (AC #7)', () => {
    const src = providerSrc()
    expect(src).toMatch(/key:\s*['"]rj-tq-cache['"]/)
  })

  it('configures the persister with retry: removeOldestQuery (AC #19)', () => {
    const src = providerSrc()
    expect(src).toMatch(/retry:\s*removeOldestQuery/)
  })

  it('uses maxAge: 24h (24 * 60 * 60 * 1000) on persistOptions', () => {
    const src = providerSrc()
    // Allow either the literal or the numeric form.
    expect(src).toMatch(/maxAge:\s*(?:24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|86_?400_?000)/)
  })

  it('onSuccess calls queryClient.resumePausedMutations() (AC #7)', () => {
    const src = providerSrc()
    expect(src).toMatch(/onSuccess\s*=\s*\{[^}]*resumePausedMutations\s*\(\s*\)/)
  })

  it('PersistQueryClientProvider wraps ToastProvider (AC #7 ordering)', () => {
    const src = providerSrc()
    const persistOpenIdx = src.indexOf('<PersistQueryClientProvider')
    const toastOpenIdx = src.indexOf('<ToastProvider')
    const persistCloseIdx = src.indexOf('</PersistQueryClientProvider>')
    const toastCloseIdx = src.indexOf('</ToastProvider>')

    expect(persistOpenIdx, 'PersistQueryClientProvider open tag not found').toBeGreaterThanOrEqual(0)
    expect(toastOpenIdx, 'ToastProvider open tag not found').toBeGreaterThanOrEqual(0)
    expect(persistCloseIdx, 'PersistQueryClientProvider close tag not found').toBeGreaterThanOrEqual(0)
    expect(toastCloseIdx, 'ToastProvider close tag not found').toBeGreaterThanOrEqual(0)

    // Persist opens before Toast opens; Persist closes after Toast closes.
    expect(persistOpenIdx).toBeLessThan(toastOpenIdx)
    expect(toastCloseIdx).toBeLessThan(persistCloseIdx)
  })
})

describe('Story 3-2 / DevTools gating (AC #10, #11)', () => {
  it('imports ReactQueryDevtools from @tanstack/react-query-devtools', () => {
    const src = providerSrc()
    expect(src).toMatch(
      /import\s*\{[^}]*ReactQueryDevtools[^}]*\}\s*from\s*['"]@tanstack\/react-query-devtools['"]/
    )
  })

  it('mounts ReactQueryDevtools only when NODE_ENV === "development"', () => {
    const src = providerSrc()
    // Match: process.env.NODE_ENV === 'development' && <ReactQueryDevtools ...
    expect(src).toMatch(
      /process\.env\.NODE_ENV\s*===\s*['"]development['"]\s*&&\s*<ReactQueryDevtools/
    )
  })

  it('does NOT use dynamic() or React.lazy for devtools (AC #10 explicitly forbids)', () => {
    const src = providerSrc()
    expect(src).not.toMatch(/dynamic\(\s*\(\s*\)\s*=>\s*import\([^)]*react-query-devtools/)
    expect(src).not.toMatch(/lazy\(\s*\(\s*\)\s*=>\s*import\([^)]*react-query-devtools/)
  })
})

describe('Story 3-2 / Eager-import ordering guard (AC #18)', () => {
  it('imports __collectiveMutationsLoadedAt from app/state/collective/mutations', () => {
    const src = providerSrc()
    expect(src).toMatch(
      /import\s*\{[^}]*__collectiveMutationsLoadedAt[^}]*\}\s*from\s*['"]app\/state\/collective\/mutations['"]/
    )
  })

  it('contains a dev-only console.warn ordering guard referencing the sentinel', () => {
    const src = providerSrc()
    // The exact form in the story:
    //   if (process.env.NODE_ENV !== 'production' && typeof __collectiveMutationsLoadedAt !== 'number') {
    //     console.warn('[rj-tq] mutations.ts side-effects did not run before Provider mounted ...')
    //   }
    expect(src).toMatch(/typeof\s+__collectiveMutationsLoadedAt\s*!==\s*['"]number['"]/)
    expect(src).toMatch(/console\.warn\([^)]*rj-tq[^)]*\)/)
  })
})
