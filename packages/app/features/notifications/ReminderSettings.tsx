/**
 * ReminderSettings — the shared notification-preferences surface (all
 * platforms). Three category toggles (streak reminders / Collective replies /
 * moderation actions) plus a streak time-of-day picker, mounted inside the
 * Preferences → Notifications section of the shared SettingsScreen.
 *
 * Category `enabled` flags and the streak `local_time` / offset written here are
 * the inputs the server-side notification fan-out reads to decide who gets
 * pushed and when. There is exactly ONE Expo push token per device (not one per
 * category) — the fan-out filters each category by its own flag — so a single
 * registration on any category-enable is sufficient, and turning a category off
 * never de-registers the token.
 *
 * Platform behavior (branch on `Platform.OS`, mirroring
 * `StreakReminderPermissionGate`):
 *  - web/desktop (`'web'`): identical toggles + mobile-only microcopy; no OS
 *    permission prompt fires (the `utils/pushTokens` stub no-ops). State still
 *    persists so it's ready for the later web/desktop push rollout.
 *  - native (`'ios'` / `'android'`): reads OS permission status on mount and,
 *    when denied, shows inline microcopy pointing to OS settings — microcopy
 *    only, never another in-app prompt.
 *
 * Reuse, don't reinvent: the registration path is `requestAndRegisterPushToken`
 * from the platform-split `app/utils/pushTokens`. An explicit toggle here is a
 * deliberate user action, so it always attempts registration on enable — the
 * automatic first-streak deny cooldown never gates it.
 */

import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { use$ } from '@legendapp/state/react'
import { Text, XStack, YStack, ExpandingLineButton } from '@my/ui'
import { store$ } from 'app/state/store'
import { getPushPermissionStatus, requestAndRegisterPushToken } from 'app/utils/pushTokens'
import { setReminderCategoryEnabled, setStreakReminderTime } from './reminderPreferences'
import { ReminderTimePicker } from './ReminderTimePicker'

type ReminderCategory = 'streak' | 'replies' | 'moderation'

const DEFAULT_STREAK_TIME = '20:00'

const CATEGORY_LABELS: Record<ReminderCategory, string> = {
  streak: 'Streak reminders',
  replies: 'Collective replies',
  moderation: 'Moderation actions',
}

const MOBILE_ONLY_HEADLINE = 'Push notifications are mobile-only at launch.'
const MOBILE_ONLY_DETAIL = 'Web and desktop see in-app reminders when you open the app.'

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

function CategoryToggle({
  category,
  enabled,
  onToggle,
}: {
  category: ReminderCategory
  enabled: boolean
  onToggle: (category: ReminderCategory, next: boolean) => void
}) {
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
    >
      <Text
        fontFamily="$body"
        fontSize="$4"
        color="$color"
      >
        {CATEGORY_LABELS[category]}
      </Text>
      <ExpandingLineButton
        size="default"
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        accessibilityLabel={CATEGORY_LABELS[category]}
        onPress={() => onToggle(category, !enabled)}
      >
        {enabled ? 'On' : 'Off'}
      </ExpandingLineButton>
    </XStack>
  )
}

export function ReminderSettings() {
  const streakEnabled = use$(store$.profile?.preferences?.reminders?.streak?.enabled) ?? false
  const repliesEnabled = use$(store$.profile?.preferences?.reminders?.replies?.enabled) ?? false
  const moderationEnabled =
    use$(store$.profile?.preferences?.reminders?.moderation?.enabled) ?? false
  const streakTime =
    use$(store$.profile?.preferences?.reminders?.streak?.local_time) ?? DEFAULT_STREAK_TIME

  const [permissionDenied, setPermissionDenied] = useState(false)

  // On native, read the OS permission status once on mount so the denied-state
  // microcopy can render. This is a read only — it never fires another prompt.
  // Off-native the stub reports 'undetermined', so we skip the check entirely.
  useEffect(() => {
    if (!isNativePlatform()) return
    let cancelled = false
    void (async () => {
      const status = await getPushPermissionStatus()
      if (!cancelled) setPermissionDenied(status === 'denied')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = (category: ReminderCategory, next: boolean) => {
    // Writer first, then (only on enable) reuse the registration path. One token
    // serves all categories; disabling flips the flag but keeps the token.
    setReminderCategoryEnabled(category, next)
    if (next) {
      // Safe on every platform — the web/desktop stub resolves to a harmless
      // no-op. An explicit toggle always attempts registration; the automatic
      // first-streak deny cooldown never gates this path.
      void requestAndRegisterPushToken()
    }
  }

  const settingsWord = Platform.OS === 'android' ? 'Android' : 'iOS'

  return (
    <YStack gap="$4">
      <CategoryToggle
        category="streak"
        enabled={streakEnabled}
        onToggle={handleToggle}
      />

      {streakEnabled && (
        <ReminderTimePicker
          value={streakTime}
          onChange={(next) => setStreakReminderTime(next)}
        />
      )}

      <CategoryToggle
        category="replies"
        enabled={repliesEnabled}
        onToggle={handleToggle}
      />

      <CategoryToggle
        category="moderation"
        enabled={moderationEnabled}
        onToggle={handleToggle}
      />

      {Platform.OS === 'web' && (
        <YStack gap="$1">
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            {MOBILE_ONLY_HEADLINE}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$color8"
          >
            {MOBILE_ONLY_DETAIL}
          </Text>
        </YStack>
      )}

      {isNativePlatform() && permissionDenied && (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          Notifications are off at the OS level. You can re-enable in {settingsWord} Settings.
        </Text>
      )}
    </YStack>
  )
}

export default ReminderSettings
