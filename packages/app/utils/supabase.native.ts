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

const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set EXPO_PUBLIC_SUPABASE_ANON_KEY'
  )
}

// Default to production URL (from .env)
let supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || ''

// Dynamically build the local URL if in development mode
import Constants from 'expo-constants'

if (__DEV__) {
  // Constants.expoConfig.hostUri looks like "192.168.1.50:8081"
  const debuggerHost = Constants.expoConfig?.hostUri

  if (debuggerHost) {
    // Extract just the IP address and append the default local Supabase port
    const localIp = debuggerHost.split(':')[0]
    supabaseUrl = `http://${localIp}:54321`
  }
}

if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL and could not infer local development URL')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
})
