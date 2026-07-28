/**
 * utils/pushTokens.native.ts — the ONLY module allowed to import
 * `expo-notifications` / `expo-device` (the platform boundary).
 *
 * Owns the OS permission ask, Expo push-token issuance, and the idempotent
 * upsert into `pushTokens$`. Metro resolves this `.native.ts` on iOS/Android;
 * web/desktop gets the no-op `pushTokens.ts` stub, so `expo-notifications` never
 * reaches the web bundle.
 *
 * Token choice: `getExpoPushTokenAsync({ projectId })` (the Expo push token, NOT
 * the raw APNs/FCM device token) — the push fan-out POSTs to Expo's hosted
 * endpoint, which requires the Expo token. `projectId` resolves from
 * `Constants.expoConfig?.extra?.eas?.projectId`; if unresolved we dev-warn and
 * abort registration gracefully (no throw into the UI).
 *
 * Idempotent registration is TWO-TIER against the named
 * `(user_id, expo_push_token)` UNIQUE constraint (NOT a local `is_deleted` scan
 * — soft-deleted rows are never present in the local synced map):
 *   Tier 1 — local pre-check via `pushTokens$.peek()`: matches only LIVE rows;
 *            touch `lastUsedAt`, no insert.
 *   Tier 2 — server-authoritative reclaim via the raw `supabase` client (sees
 *            soft-deleted rows, which RLS scopes by `user_id` not `is_deleted`):
 *            reclaim the found row (`is_deleted: false`) and mirror it into the
 *            local observable at the SAME id. Only when both tiers find nothing
 *            do we insert a fresh-`uuid()` row through the offline-queued path.
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { pushTokens$ } from 'app/state/push_tokens'
import { supabase, syncUserId$ } from 'app/state/syncConfig'
import { generateUUID } from 'app/utils/uuid'
import type { PushToken } from 'app/state/types'

/** Outcome of a push-token registration attempt (mirrors the web stub). */
export type PushRegistrationOutcome =
  | { outcome: 'granted' } // token issued/reused and upserted
  | { outcome: 'granted-no-token' } // OS grant succeeded but token issuance failed
  | { outcome: 'denied' } // OS permission not granted
  | { outcome: 'unsupported' } // non-native platform (web stub only)

function devWarn(message: string, error?: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[push-tokens] ${message}`, error ?? '')
  }
}

function resolveProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId as string | undefined
}

/**
 * Read-only OS permission status. Does NOT call `requestPermissionsAsync`, so
 * the gate can decide modal-vs-silent-register before asking.
 */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Notifications.getPermissionsAsync()
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
  } catch (error) {
    devWarn('getPermissionsAsync failed', error)
    return 'undetermined'
  }
}

/**
 * True when a live (non-deleted) push token already exists locally for the given
 * user. Synchronous, non-reactive `.peek()` scan. Exported for the
 * re-enable-from-preferences path so it can reuse an existing token instead of
 * re-prompting.
 * Soft-deleted rows are never present in the local map, so this only ever
 * matches a live row.
 */
export function hasLivePushToken(userId: string): boolean {
  const rows = pushTokens$.peek() ?? {}
  return Object.values(rows).some((row) => row?.userId === userId)
}

/**
 * Requests OS notification permission (if not already granted), issues an Expo
 * push token on grant, and idempotently upserts it into `pushTokens$`. Safe to
 * call directly from the re-enable-from-preferences flow: a live token is reused (touch
 * `lastUsedAt`, no re-prompt) via Tier 1. Re-entrant calls share one in-flight
 * promise so a fast double-tap never fires two permission requests.
 */
export function requestAndRegisterPushToken(): Promise<PushRegistrationOutcome> {
  if (inFlight) return inFlight
  inFlight = runRegistration().finally(() => {
    inFlight = null
  })
  return inFlight
}

let inFlight: Promise<PushRegistrationOutcome> | null = null

async function runRegistration(): Promise<PushRegistrationOutcome> {
  const { status } = await Notifications.requestPermissionsAsync()
  // `status === 'granted'` is the single source of truth — a non-granted
  // iOS provisional/ephemeral result follows the deny path (no token, cooldown).
  if (status !== 'granted') {
    return { outcome: 'denied' }
  }

  // Grant succeeded — attempt token issuance. Any failure here is NOT a deny
  // (no cooldown): return `granted-no-token` so the re-enable flow can retry issuance.
  const projectId = resolveProjectId()
  if (!projectId) {
    devWarn('missing expoConfig.extra.eas.projectId — cannot issue Expo push token')
    return { outcome: 'granted-no-token' }
  }

  let expoPushToken: string
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId })
    expoPushToken = result.data
  } catch (error) {
    devWarn('getExpoPushTokenAsync failed (offline/simulator)', error)
    return { outcome: 'granted-no-token' }
  }
  if (!expoPushToken) {
    return { outcome: 'granted-no-token' }
  }

  const userId = syncUserId$.peek()
  if (!userId) {
    devWarn('no current user id — cannot persist push token')
    return { outcome: 'granted-no-token' }
  }

  const now = new Date().toISOString()
  const platform = Platform.OS as 'ios' | 'android'
  const deviceLabel = Device.deviceName ?? null

  await upsertPushToken({ userId, expoPushToken, platform, deviceLabel, now })
  return { outcome: 'granted' }
}

async function upsertPushToken(params: {
  userId: string
  expoPushToken: string
  platform: 'ios' | 'android'
  deviceLabel: string | null
  now: string
}): Promise<void> {
  const { userId, expoPushToken, platform, deviceLabel, now } = params

  // Tier 1 — local pre-check (live rows only). Match → touch lastUsedAt.
  const rows = pushTokens$.peek() ?? {}
  for (const [id, row] of Object.entries(rows)) {
    if (row?.userId === userId && row?.expoPushToken === expoPushToken) {
      pushTokens$[id]!.assign({ lastUsedAt: now, platform, deviceLabel })
      return
    }
  }

  // Tier 2 — server-authoritative reclaim (sees soft-deleted rows). Direct raw
  // client call bypasses the synced observable's local-only view.
  try {
    const { data, error } = await supabase
      .from('user_push_tokens')
      .select('id')
      .eq('user_id', userId)
      .eq('expo_push_token', expoPushToken)
      .maybeSingle()

    if (!error && data?.id) {
      const foundId = data.id
      await supabase
        .from('user_push_tokens')
        .update({ last_used_at: now, is_deleted: false, platform, device_label: deviceLabel })
        .eq('id', foundId)
      // Mirror into the local observable at the SAME id so the local key matches
      // the server row (no second row).
      const reclaimed: PushToken = {
        id: foundId,
        userId,
        expoPushToken,
        platform,
        deviceLabel,
        lastUsedAt: now,
      }
      pushTokens$[foundId]!.set(reclaimed)
      return
    }
  } catch (error) {
    // Offline / network error during the direct reclaim call: fall through to
    // the fresh-insert path. If a soft-deleted-row collision exists it will
    // 23505 once it syncs — treated as non-fatal (self-heals on the next
    // online registration attempt).
    devWarn('Tier 2 reclaim lookup failed — falling back to insert', error)
  }

  // Fresh insert — offline-queued and replayed by Legend-State.
  const id = generateUUID()
  const fresh: PushToken = {
    id,
    userId,
    expoPushToken,
    platform,
    deviceLabel,
    lastUsedAt: now,
  }
  pushTokens$[id]!.set(fresh)
}
