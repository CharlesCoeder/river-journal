/**
 * Supabase client for React Native (mobile)
 * Uses an AES-256 encrypted MMKV instance for session persistence instead of
 * AsyncStorage. The refresh token in the session is sensitive, so the MMKV
 * encryption key is stored in the platform keychain (Expo SecureStore).
 * See utils/secureMmkv.native.ts for the storage adapter, migration and fallback.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { secureMmkvStorageAdapter } from './secureMmkv.native'

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

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureMmkvStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
})
