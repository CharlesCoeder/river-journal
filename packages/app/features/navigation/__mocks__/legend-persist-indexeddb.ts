/**
 * No-op stub for @legendapp/state/persist-plugins/indexeddb in Vitest/Node.js
 * test environments.
 *
 * Why this exists: persistConfig.ts constructs `observablePersistIndexedDB(...)`
 * at import time, and the top-level `syncedSupabase(...)` wraps in entries.ts /
 * flows.ts / grace_days.ts activate persistence eagerly when those modules are
 * imported. The real plugin's `loadTable` throws when `indexedDB` is undefined
 * (node + happy-dom both lack it), surfacing as an async unhandled rejection
 * that lands in unrelated test files and drives run-to-run flakiness.
 *
 * Tests that genuinely exercise persistence mock the storage layer explicitly;
 * for everyone else this in-memory no-op keeps the persist plugin inert.
 */

class ObservablePersistIndexedDB {
  private tableData: Record<string, unknown> = {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_configuration?: unknown) {}

  async initialize(_configOptions?: unknown): Promise<void> {}

  // Returning undefined signals "no persisted data" — load resolves immediately.
  loadTable(_table: string, _config?: unknown): void {}

  getTable(_table: string, _init?: unknown, _config?: unknown): undefined {
    return undefined
  }

  getMetadata(_table: string, _config?: unknown): Record<string, never> {
    return {}
  }

  async setMetadata(_table: string, _metadata?: unknown, _config?: unknown): Promise<void> {}

  async deleteMetadata(_table: string, _config?: unknown): Promise<void> {}

  async set(_table: string, _changes?: unknown, _config?: unknown): Promise<void> {}

  async deleteTable(_table: string, _config?: unknown): Promise<void> {}
}

export function observablePersistIndexedDB(configuration?: unknown) {
  return new ObservablePersistIndexedDB(configuration)
}

export { ObservablePersistIndexedDB }
