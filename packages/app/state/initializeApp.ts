import { syncObservable } from '@legendapp/state/sync'
import { syncState, when, observe } from '@legendapp/state'
import { batch } from '@legendapp/state'
import { observable } from '@legendapp/state'
import { configurePersistence } from './persistConfig'
import { store$, ephemeral$, countUndecidedOrphans } from './store'
import { billingReceipt$ } from './billing'
import { scheduleAppOpenReValidation } from './appOpenReValidation'
import { flows$ } from './flows'
import { entries$ } from './entries'
import { graceDays$ } from './grace_days'
import { pushTokens$ } from './push_tokens'
import {
  generateUUID,
  isSyncReady$,
  syncUserId$,
  orphanFlowsPending$,
  deviceState$,
} from './syncConfig'
import { initAuthListener } from '../utils/auth'
import { isEncryptionReadyForSync$ } from './encryptionSetup'
import { lapsed$, recordSessionOpen } from './lapsed'
import { onboarding$ } from './onboarding'
import { authReturn$, flushPendingAgeAttestation } from './authReturn'
import { syncDeviceTimezone } from './timezoneSync'
import { startTodayTracking } from './today'
import { appLock$ } from './appLock'
import { startAppLockTracking } from './appLockTracking'
import { runPostDeletionCleanup } from './accountCleanup'
import { telemetryConsent$ } from './telemetryConsent'
import { initSentry, setSentryUser } from '../utils/telemetry/sentry'
import './streak' // attaches store$.views.streak side-effect

export const appStatus$ = observable({
  isPersistenceLoaded: false,
  error: null as Error | null,
})

function setupPersistence() {
  // Persist the core store only (session, profile, activeFlow, lastSavedFlow).
  // flows$ and entries$ handle their own persistence via syncedSupabase({ persist }).
  syncObservable(
    store$,
    configurePersistence({
      persist: {
        name: 'app-state',
      },
    })
  )

  // Persist lapsed-state in its own IndexedDB table / MMKV namespace.
  // Local-only — no Supabase sync, no encryption.
  syncObservable(lapsed$, configurePersistence({ persist: { name: 'lapsed-state' } }))

  // Persist device-state (lastAuthedUserId + acknowledgedAccountTransitions).
  // Local-only — drives previous-account banner across sign-out boundaries.
  syncObservable(deviceState$, configurePersistence({ persist: { name: 'device-state' } }))

  // Persist onboarding-state (completion flag + resume screen).
  // Local-only, never synced — first-launch gate reads this before children render.
  syncObservable(onboarding$, configurePersistence({ persist: { name: 'onboarding-state' } }))

  // Persist auth-return markers (pending Collective return + deferred Google-web
  // attestation). Local-only, never synced — must survive the web full-page
  // Google OAuth redirect and be rehydrated before HomeScreen mounts (see the
  // isPersistLoaded gate below and state/authReturn.ts).
  syncObservable(authReturn$, configurePersistence({ persist: { name: 'auth-return' } }))

  // Persist the app-open re-validation receipt (local-only, never synced,
  // never encrypted) so the opportunistic entitlement refresh survives a cold
  // start. See state/billing.ts.
  syncObservable(billingReceipt$, configurePersistence({ persist: { name: 'billing-receipt' } }))

  // Persist the App Lock preference (on/off + auto-lock interval + passcode
  // salt/verifier). Local-only, per-device, never synced — see state/appLock.ts.
  syncObservable(appLock$, configurePersistence({ persist: { name: 'app-lock' } }))

  // Persist the telemetry consent flag (opt-in, default OFF). Local-only,
  // per-device, never synced — see state/telemetryConsent.ts. Read after load
  // to decide whether telemetry SDKs may initialize this launch.
  syncObservable(
    telemetryConsent$,
    configurePersistence({ persist: { name: 'telemetry-consent' } })
  )

  // Activate the synced observables so their persistence loads.
  // syncedSupabase uses lazy activation — calling .get() triggers persistence
  // loading while remote sync waits for the waitFor gate.
  flows$.get()
  entries$.get()
  // graceDays follows the same lazy-activation + persist pattern as flows$/entries$
  graceDays$.get()
  // pushTokens follows the same lazy-activation + persist pattern as graceDays$
  pushTokens$.get()
}

function setupSyncReadinessGate() {
  // Reactively wire isSyncReady$, syncUserId$, and orphanFlowsPending$ to
  // store$.session, avoiding circular imports between store.ts and flows.ts/entries.ts.
  observe(() => {
    const isAuthenticated = store$.session.isAuthenticated.get()
    const syncEnabled = store$.session.syncEnabled.get()
    const userId = store$.session.userId.get()
    const isEncryptionReadyForSync = isEncryptionReadyForSync$.get()

    if (!isAuthenticated || !syncEnabled || !userId || !isEncryptionReadyForSync) {
      // Not ready for sync — clear orphan state and close gate
      orphanFlowsPending$.set(null)
      isSyncReady$.set(false)
      syncUserId$.set(userId)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] closed', {
          isAuthenticated,
          syncEnabled,
          userId: userId?.slice(0, 8) ?? null,
          isEncryptionReadyForSync,
        })
      }
      return
    }

    // Authenticated + sync enabled: check for undecided orphan flows
    syncUserId$.set(userId)
    const { flowCount, entryCount } = countUndecidedOrphans()

    if (flowCount > 0 || entryCount > 0) {
      // Orphans pending user decision — keep gate closed, show dialog
      orphanFlowsPending$.set({ flowCount, entryCount, userId })
      isSyncReady$.set(false)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] orphans pending consent', {
          flowCount,
          entryCount,
          userId: userId.slice(0, 8),
        })
      }
    } else {
      // No undecided orphans — open sync gate immediately
      orphanFlowsPending$.set(null)
      isSyncReady$.set(true)

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔗 [syncGate] open (no orphans)', { userId: userId.slice(0, 8) })
      }
    }
  })
}

function setupAttestationFlush() {
  // Google web/desktop OAuth is a full-page redirect, so the 13+ attestation
  // can't be recorded inline. The gate sets a persisted `pendingAgeAttestation`
  // marker before initiating OAuth; here we flush it once a session exists
  // (userId transitions to non-null). Best-effort + idempotent-if-null: an
  // abandoned OAuth attempt never fires this (no userId), and a redundant flush
  // on a returning user is a no-op.
  observe(() => {
    const userId = store$.session.userId.get()
    if (userId) {
      void flushPendingAgeAttestation(userId)
    }
  })
}

function setupTimezoneSync() {
  // Independent of the journal sync gate (which requires syncEnabled +
  // encryption ready). The server-side daily-500 RLS predicate reads
  // users.timezone, so this column must track the device IANA zone for
  // collective posting to work even when journal sync is disabled.
  observe(() => {
    const isAuthenticated = store$.session.isAuthenticated.get()
    const userId = store$.session.userId.get()
    if (isAuthenticated && userId) {
      void syncDeviceTimezone()
    }
  })
}

function ensureLocalSessionId() {
  const existingLocalSessionId = store$.session.localSessionId.get()
  if (existingLocalSessionId) return

  store$.session.localSessionId.set(generateUUID())
}

/**
 * Boot-resume for an interrupted post-deletion local cleanup. If the app was
 * closed mid-cleanup, the persisted marker survives restart; re-fire the seam so
 * the local purge + sign-out eventually finish without any user action. Called
 * AFTER `initAuthListener()` so that if a deferred server-side auth-finalize
 * re-hydrated a lingering session, this pass's `signOut()` still tears it down.
 * Fire-and-forget with a metadata-only `.catch` — NEVER awaited on the boot
 * critical path (a slow/failed network sign-out must not block startup); a
 * failure leaves the marker set so the next launch retries.
 */
export function resumePendingAccountCleanupIfNeeded() {
  if (!deviceState$.pendingAccountCleanup.peek()) return

  void runPostDeletionCleanup().catch((error) => {
    console.warn(
      '[account-cleanup] boot-resume post-deletion cleanup did not complete',
      error instanceof Error ? error.message : 'unknown error'
    )
  })
}

/**
 * Boot telemetry gate: run once after persistence load. Telemetry is opt-in, so
 * the Sentry SDK must NOT initialize at module load (before persistence) — the
 * consent flag is only readable after `initializePersistence()` awaits
 * `isPersistLoaded`. Init only if the user opted in; otherwise no init runs
 * and zero telemetry traffic leaves the device this launch (on web/desktop the
 * SDK module is still statically imported; only init is deferred). A late toggle
 * re-runs init via utils/telemetry/consent.ts, no restart.
 *
 * Accepted tradeoff: consented users have no crash coverage during the
 * module-load → persistence-loaded window — inherent to a persisted opt-in gate,
 * since the flag isn't readable until persistence resolves.
 */
export function applyBootTelemetryGate() {
  if (!telemetryConsent$.enabled.peek()) return

  try {
    initSentry()
    // Auth INITIAL_SESSION can hydrate the persisted session before the SDK
    // inits on boot, dropping the identify that utils/auth.ts would fire.
    // Re-identify the persisted user now (user_id only, never PII).
    const userId = store$.session.userId.peek()
    if (userId) {
      setSentryUser(userId)
    }
  } catch (error) {
    // Telemetry must never reject initializePersistence() and blank the app.
    console.warn(
      '[telemetry] boot init failed',
      error instanceof Error ? error.message : 'unknown error'
    )
  }
}

export async function initializePersistence() {
  try {
    setupPersistence()
    setupSyncReadinessGate()
    setupAttestationFlush()
    setupTimezoneSync()

    const persistencePromises = [
      when(syncState(store$).isPersistLoaded),
      when(syncState(flows$).isPersistLoaded),
      when(syncState(entries$).isPersistLoaded),
      when(syncState(lapsed$).isPersistLoaded),
      when(syncState(graceDays$).isPersistLoaded),
      when(syncState(pushTokens$).isPersistLoaded),
      when(syncState(deviceState$).isPersistLoaded),
      when(syncState(onboarding$).isPersistLoaded),
      when(syncState(authReturn$).isPersistLoaded),
      when(syncState(billingReceipt$).isPersistLoaded),
      when(syncState(appLock$).isPersistLoaded),
      when(syncState(telemetryConsent$).isPersistLoaded),
    ]

    await Promise.all(persistencePromises)
    ensureLocalSessionId()
    recordSessionOpen()

    // Telemetry cold-start gate: consent is opt-in and only readable now that
    // persistence has loaded. See applyBootTelemetryGate for the full rationale
    // and the accepted pre-persistence-load coverage gap.
    applyBootTelemetryGate()

    // App Lock cold-start gate: once the (persisted) preference has loaded, a
    // fresh launch with App Lock enabled must lock BEFORE any journal frame
    // paints. `ephemeral$.isLocked` is non-persisted, so it starts false every
    // launch; set it true here, after persistence load, so the overlay covers
    // content from the first render. Then start the lifecycle controller for
    // return-from-background re-locking.
    if (appLock$.enabled.peek()) {
      ephemeral$.isLocked.set(true)
    }
    startAppLockTracking()

    // Initialize auth listener — fires INITIAL_SESSION immediately to hydrate
    // session state, then handles SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, etc.
    initAuthListener()

    // Resume an interrupted post-deletion local cleanup, if one was left
    // pending by a mid-cleanup app close. Placed after initAuthListener() so a
    // re-hydrated lingering session still gets torn down. Fire-and-forget.
    resumePendingAccountCleanupIfNeeded()

    // Opportunistic app-open entitlement refresh (best-effort supplement to the
    // server-side daily expiry sweep + provider push webhooks). Fire-and-forget
    // and deferred until a session is known (the auth listener hydrates the
    // session asynchronously, so firing before the JWT exists would 401 as a
    // silent no-op on a cold boot). Never awaited on the boot path.
    scheduleAppOpenReValidation()

    // Start the midnight-rollover tick so streak/day surfaces recompute when the
    // local clock crosses midnight (and on app foreground) rather than freezing
    // until the next remount. Idempotent; see state/today.ts.
    startTodayTracking()

    // Dev flag: auto-enable sync via env var so developers can test sync
    // without waiting for the UI toggle story. Add to your .env.local:
    //   NEXT_PUBLIC_SYNC_ENABLED=true   (web / desktop)
    //   EXPO_PUBLIC_SYNC_ENABLED=true   (mobile)
    const envSyncEnabled =
      process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' ||
      process.env.EXPO_PUBLIC_SYNC_ENABLED === 'true'

    if (envSyncEnabled) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.log('🔄 Sync auto-enabled via env flag')
      }
    }

    batch(() => {
      if (envSyncEnabled) {
        store$.session.syncEnabled.set(true)
      }
      appStatus$.isPersistenceLoaded.set(true)
      appStatus$.error.set(null)
    })
  } catch (e) {
    appStatus$.error.set(e as Error)
    console.error('Failed to initialize persistence', e)
    throw e
  }
}
