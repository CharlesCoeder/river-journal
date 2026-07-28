/**
 * AppLockSettings — the shared App Lock preferences surface (all platforms),
 * mounted inside Preferences → Privacy of the shared SettingsScreen.
 *
 * App Lock is a casual-access barrier, NOT encryption, and is device-scoped
 * (never synced, never auth-gated). The toggle defaults OFF. Enabling runs the
 * platform-appropriate flow:
 *  - native (iOS/Android): detect biometric / device-credential capability; if
 *    neither exists, the toggle renders disabled with plain copy explaining why.
 *  - web/desktop: walk the user through defining an app-level passcode (min 6,
 *    entered twice, never stored plaintext — only a scrypt-derived verifier is
 *    persisted; see state/appLock.ts).
 * Disabling clears the passcode and immediately drops any active lock.
 *
 * Toggle shape mirrors ReminderSettings' CategoryToggle (accessibilityRole
 * "switch" + accessibilityState). Persistence targets the NON-synced `appLock$`
 * — never store$.profile.
 */

import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { use$ } from '@legendapp/state/react'
import { Text, XStack, YStack, View, ExpandingLineButton, Input } from '@my/ui'
import {
  appLock$,
  setAppLockEnabled,
  setAutoLockInterval,
  setPasscode,
  clearPasscode,
  MIN_PASSCODE_LENGTH,
  type AutoLockInterval,
} from '../../state/appLock'
import { ephemeral$ } from '../../state/store'
import { getAppLockCapability, type AppLockCapability } from 'app/utils/appLockAuth'

const THREAT_MODEL_COPY =
  'App Lock prevents casual access on a shared device. It does not add encryption — your data protection settings are in Privacy Center.'

const UNRECOVERABLE_COPY =
  'This passcode cannot be recovered. If you forget it, the only way back in is to disable App Lock from an already-unlocked session — there is no reset and no data is erased.'

const NO_CAPABILITY_COPY =
  "Set up Face ID, Touch ID, or a device passcode in your phone's settings to use App Lock."

const INTERVAL_OPTIONS: { value: AutoLockInterval; label: string }[] = [
  { value: 'immediately', label: 'Immediately' },
  { value: '1m', label: 'After 1 minute' },
  { value: '5m', label: 'After 5 minutes' },
]

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android'
}

export function AppLockSettings() {
  const enabled = use$(appLock$.enabled)
  const interval = use$(appLock$.autoLockInterval)

  const [capability, setCapability] = useState<AppLockCapability | null>(null)
  const [showPasscodeSetup, setShowPasscodeSetup] = useState(false)
  const [passcode, setPasscodeInput] = useState('')
  const [confirm, setConfirmInput] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)

  // Native only: read biometric / device-credential capability once on mount so
  // the disabled-toggle + explanatory copy can render. A read only; no prompt.
  useEffect(() => {
    if (!isNativePlatform()) return
    let cancelled = false
    void (async () => {
      const cap = await getAppLockCapability()
      if (!cancelled) setCapability(cap)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const capabilityUnavailable = isNativePlatform() && capability !== null && !capability.available

  const disableAppLock = () => {
    clearPasscode()
    setAppLockEnabled(false)
    ephemeral$.isLocked.set(false)
    setShowPasscodeSetup(false)
    setPasscodeInput('')
    setConfirmInput('')
    setSetupError(null)
  }

  const handleToggle = async () => {
    if (enabled) {
      disableAppLock()
      return
    }

    if (Platform.OS === 'web') {
      // Open the passcode-setup flow; enablement completes on submit.
      setSetupError(null)
      setPasscodeInput('')
      setConfirmInput('')
      setShowPasscodeSetup(true)
      return
    }

    // Native: proceed only when a biometric or device credential is available.
    const cap = capability ?? (await getAppLockCapability())
    setCapability(cap)
    if (!cap.available) return
    setAppLockEnabled(true)
  }

  const handlePasscodeSubmit = async () => {
    if (passcode.length < MIN_PASSCODE_LENGTH) {
      setSetupError(`Use at least ${MIN_PASSCODE_LENGTH} characters.`)
      return
    }
    if (passcode !== confirm) {
      setSetupError('The two passcodes do not match.')
      return
    }
    try {
      await setPasscode(passcode)
    } catch {
      setSetupError('That passcode cannot be used.')
      return
    }
    setAppLockEnabled(true)
    setShowPasscodeSetup(false)
    setPasscodeInput('')
    setConfirmInput('')
    setSetupError(null)
  }

  return (
    <YStack gap="$4">
      <XStack
        justifyContent="space-between"
        alignItems="center"
      >
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$color"
        >
          App Lock
        </Text>
        <ExpandingLineButton
          size="default"
          accessibilityRole="switch"
          accessibilityLabel="App Lock"
          accessibilityState={{ checked: enabled }}
          disabled={capabilityUnavailable}
          onPress={handleToggle}
        >
          {enabled ? 'On' : 'Off'}
        </ExpandingLineButton>
      </XStack>

      {/* Honest threat-model copy — shown on every platform. */}
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$color8"
        lineHeight={20}
      >
        {THREAT_MODEL_COPY}
      </Text>

      {/* Native: explain why the toggle is disabled when no OS security exists. */}
      {capabilityUnavailable && (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$color8"
          lineHeight={20}
        >
          {NO_CAPABILITY_COPY}
        </Text>
      )}

      {/* Web/desktop passcode setup. */}
      {showPasscodeSetup && (
        <YStack gap="$3">
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$color8"
            lineHeight={20}
          >
            {UNRECOVERABLE_COPY}
          </Text>
          <Input
            testID="app-lock-passcode-input"
            value={passcode}
            onChangeText={setPasscodeInput}
            secureTextEntry
            placeholder="Passcode (min 6 characters)"
          />
          <Input
            testID="app-lock-passcode-confirm-input"
            value={confirm}
            onChangeText={setConfirmInput}
            onSubmitEditing={handlePasscodeSubmit}
            secureTextEntry
            placeholder="Re-enter passcode"
          />
          {setupError && (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$color8"
            >
              {setupError}
            </Text>
          )}
          <ExpandingLineButton
            size="default"
            testID="app-lock-passcode-submit"
            onPress={handlePasscodeSubmit}
          >
            Set passcode
          </ExpandingLineButton>
        </YStack>
      )}

      {/* Auto-lock interval selector — only while App Lock is enabled. */}
      {enabled && (
        <YStack gap="$3">
          <Text
            fontFamily="$body"
            fontSize={13}
            textTransform="uppercase"
            letterSpacing={1.5}
            color="$color8"
          >
            Auto-lock
          </Text>
          {INTERVAL_OPTIONS.map((option) => (
            <XStack
              key={option.value}
              justifyContent="space-between"
              alignItems="center"
            >
              <View opacity={interval === option.value ? 1 : 0.4}>
                <ExpandingLineButton
                  size="default"
                  testID={`app-lock-interval-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: interval === option.value }}
                  onPress={() => setAutoLockInterval(option.value)}
                >
                  {option.label}
                </ExpandingLineButton>
              </View>
            </XStack>
          ))}
        </YStack>
      )}
    </YStack>
  )
}

export default AppLockSettings
