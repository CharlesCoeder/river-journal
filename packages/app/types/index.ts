import type { Database, Tables } from './database'

export type { Database }
export type DbUser = Tables<'users'>
export type DbDailyEntry = Tables<'daily_entries'>
export type DbFlow = Tables<'flows'>
export type EncryptionMode = DbUser['encryption_mode']
