import { describe, it, expect, vi } from 'vitest'

vi.mock('../../utils/supabase', () => ({
  supabase: {},
}))

import {
  generateUUID,
  dbEntryToLocal,
  localEntryToDb,
  dbFlowToLocal,
  localFlowToDb,
} from '../syncConfig'

describe('generateUUID', () => {
  it('returns a valid UUID v4 format', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUUID()))
    expect(ids.size).toBe(100)
  })
})

describe('Entry transforms', () => {
  const dbRow = {
    id: 'e1',
    entry_date: '2026-03-03',
    user_id: 'u1',
    created_at: '2026-03-03T10:00:00Z',
    updated_at: '2026-03-03T12:00:00Z',
    is_deleted: false,
  }

  it('dbEntryToLocal converts snake_case → camelCase', () => {
    const local = dbEntryToLocal(dbRow)
    expect(local).toEqual({
      id: 'e1',
      entryDate: '2026-03-03',
      lastModified: '2026-03-03T12:00:00Z',
      user_id: 'u1',
      local_session_id: '',
    })
  })

  it('localEntryToDb converts camelCase → snake_case', () => {
    const db = localEntryToDb({
      id: 'e1',
      entryDate: '2026-03-03',
      lastModified: '2026-03-03T12:00:00Z',
      user_id: 'u1',
      local_session_id: 'sess1',
    })
    expect(db).toEqual({
      id: 'e1',
      entry_date: '2026-03-03',
      user_id: 'u1',
    })
    // local-only fields must not leak to DB
    expect(db).not.toHaveProperty('local_session_id')
    expect(db).not.toHaveProperty('lastModified')
    expect(db).not.toHaveProperty('updated_at')
  })

  it('localEntryToDb handles partial updates', () => {
    const db = localEntryToDb({ id: 'e1', entryDate: '2026-03-04' })
    expect(db).toEqual({ id: 'e1', entry_date: '2026-03-04' })
  })
})

describe('Flow transforms', () => {
  const dbRow = {
    id: 'f1',
    daily_entry_id: 'e1',
    content: 'Hello world',
    word_count: 2,
    created_at: '2026-03-03T10:05:00Z',
    updated_at: '2026-03-03T10:05:00Z',
    is_deleted: false,
  }

  it('dbFlowToLocal converts snake_case → camelCase', () => {
    const local = dbFlowToLocal(dbRow)
    expect(local).toEqual({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'Hello world',
      wordCount: 2,
      timestamp: '2026-03-03T10:05:00Z',
      local_session_id: '',
    })
  })

  it('dbFlowToLocal maps created_at → timestamp', () => {
    const local = dbFlowToLocal(dbRow)
    expect(local.timestamp).toBe(dbRow.created_at)
  })

  it('localFlowToDb converts camelCase → snake_case', () => {
    const db = localFlowToDb({
      id: 'f1',
      dailyEntryId: 'e1',
      content: 'Hello world',
      wordCount: 2,
      timestamp: '2026-03-03T10:05:00Z',
      local_session_id: 'sess1',
    })
    expect(db).toEqual({
      id: 'f1',
      daily_entry_id: 'e1',
      content: 'Hello world',
      word_count: 2,
      created_at: '2026-03-03T10:05:00Z',
    })
    expect(db).not.toHaveProperty('local_session_id')
    expect(db).not.toHaveProperty('user_id')
  })

  it('localFlowToDb handles partial updates', () => {
    const db = localFlowToDb({ id: 'f1', content: 'Updated text', wordCount: 2 })
    expect(db).toEqual({
      id: 'f1',
      content: 'Updated text',
      word_count: 2,
    })
    expect(db).not.toHaveProperty('daily_entry_id')
  })
})
