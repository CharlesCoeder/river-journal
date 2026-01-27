/**
 * Supabase client for React Native (mobile)
 * Uses MMKV for session persistence instead of AsyncStorage
 */

import { createClient } from '@supabase/supabase-js'
import { MMKV } from 'react-native-mmkv'

// Create a dedicated MMKV instance for Supabase auth storage
const authStorage = new MMKV({ id: 'supabase-auth' })

// Supabase-compatible storage adapter for MMKV
const mmkvStorageAdapter = {
  getItem: (key: string): string | null => {
    return authStorage.getString(key) ?? null
  },
  setItem: (key: string, value: string): void => {
    authStorage.set(key, value)
  },
  removeItem: (key: string): void => {
    authStorage.delete(key)
  },
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
