/**
 * timezoneSync.ts
 *
 * Boot-time sync of the device's IANA timezone into `users.timezone`. The
 * server-side daily-500 RLS predicate computes "today" in this stored zone,
 * so an out-of-date value means the user gets 403'd on collective post
 * insert during the UTC-vs-local rollover window.
 *
 * Runs idempotently: PATCHes only when the resolved zone differs from
 * what was last synced this session. Failures are swallowed — we'll retry
 * on the next sign-in or boot.
 */

import { store$ } from './store'
import { supabase } from '../utils/supabase'

const resolveDeviceTimezone = (): string | null => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && tz.length > 0 ? tz : null
  } catch {
    return null
  }
}

export const syncDeviceTimezone = async (): Promise<void> => {
  const userId = store$.session.userId.peek()
  if (!userId) return

  const tz = resolveDeviceTimezone()
  if (!tz) return

  if (store$.session.lastSyncedTimezone.peek() === tz) return

  try {
    const { error } = await supabase
      .from('users')
      .update({ timezone: tz })
      .eq('id', userId)

    if (error) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('🌐 [timezoneSync] PATCH failed; will retry next boot', error.message)
      }
      return
    }

    store$.session.lastSyncedTimezone.set(tz)
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('🌐 [timezoneSync] threw; will retry next boot', e)
    }
  }
}
