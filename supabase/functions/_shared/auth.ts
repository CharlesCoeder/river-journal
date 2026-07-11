// Auth envelope for Edge Functions — two request-auth postures.
//
// 1. TRIGGER-CONTEXT (this epic's notify_moderation_action). The function is
//    invoked by a Postgres pg_net trigger carrying the service-role bearer, and
//    config sets verify_jwt = false, so the bearer compare is the ONLY inbound
//    wall. It reads/writes the DB via createServiceRoleClient() (which bypasses
//    RLS — required to read collective_posts.user_id for the remove_post author
//    derivation). Gate inbound requests with requireServiceRole(req).
//
// 2. ADMIN-CONTEXT (future functions, later epics). getAuthenticatedUser(req)
//    validates the caller's JWT and requireAdmin(payload) enforces
//    is_admin === true. Only the shape is needed now; ship it so later
//    functions don't reinvent it.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { err } from './responses.ts'

// Service-role client for trigger-context functions. Constructed from the
// Edge-Runtime-auto-injected SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; no
// session persistence (each invocation is stateless).
export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

// Length-checked, constant-time compare. A plain === (or startsWith) can leak
// information via early-exit timing and would wrongly accept a prefix; encoding
// to bytes + a length gate + timingSafeEqual avoids both.
function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) {
    return false
  }
  return timingSafeEqual(aBytes, bBytes)
}

// Gate a trigger-invoked request. Returns a falsy value (null) when the bearer
// matches SUPABASE_SERVICE_ROLE_KEY exactly, so callers write:
//   const denied = requireServiceRole(req); if (denied) return denied
// Returns a 401 Response (never throws) on a missing/empty/mismatched bearer,
// or when the expected key is itself unset (never silently authorizes). The
// 401 body never echoes the expected key.
export function requireServiceRole(req: Request): Response | null {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const prefix = 'Bearer '
  const bearer = header.startsWith(prefix) ? header.slice(prefix.length) : ''

  const unauthorized = () => err('unauthorized', { code: 'unauthorized', status: 401 })

  if (!expected || expected.length === 0) {
    return unauthorized()
  }
  if (bearer.length === 0) {
    return unauthorized()
  }
  if (!constantTimeEquals(bearer, expected)) {
    return unauthorized()
  }
  return null
}

// Admin-context stub (future functions): validate the caller's JWT and return
// the user, or null when unauthenticated/invalid. Uses a user-scoped client
// (anon key) so RLS still applies to any subsequent reads.
export async function getAuthenticatedUser(req: Request): Promise<User | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey || token.length === 0) {
    return null
  }
  const client = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) {
    return null
  }
  return data.user
}

// Admin-context stub (future functions): enforce the is_admin claim.
export function requireAdmin(payload: { is_admin?: boolean } | null | undefined): boolean {
  return payload?.is_admin === true
}
