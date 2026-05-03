import { Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useHotkeyRecorder } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { resetHotkeyOverride, setHotkeyOverride, store$ } from 'app/state/store'
import { DEFAULT_HOTKEYS } from 'app/features/navigation/useKeyboardShortcuts'
import type { HotkeyActionId } from 'app/state/types'

const SHORTCUT_ROWS: { id: HotkeyActionId; label: string }[] = [
  { id: 'newEntry', label: 'New Entry' },
  { id: 'openSettings', label: 'Open Settings' },
  { id: 'exitEditor', label: 'Exit Editor' },
]

export function formatHotkeyDisplay(hotkey: string): string {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().includes('MAC')
  return hotkey.replace('Mod+', isMac ? '⌘' : 'Ctrl+').replace('Escape', 'Esc')
}

export function KeyboardShortcutsSection() {
  const profile = use$(store$.profile) as
    | { hotkeyOverrides?: Partial<Record<HotkeyActionId, string>> }
    | null
    | undefined
  const overrides = profile?.hotkeyOverrides ?? {}
  const [recordingId, setRecordingId] = useState<HotkeyActionId | null>(null)

  const recorder = useHotkeyRecorder({
    onRecord: (hotkey: string) => {
      if (recordingId) {
        setHotkeyOverride(recordingId, hotkey)
        setRecordingId(null)
      }
    },
    onCancel: () => setRecordingId(null),
  })

  return (
    <YStack gap="$1">
      {SHORTCUT_ROWS.map((row) => {
        const isRecording = recordingId === row.id
        const currentBinding = overrides[row.id] ?? DEFAULT_HOTKEYS[row.id]
        const showReset =
          overrides[row.id] !== undefined && overrides[row.id] !== DEFAULT_HOTKEYS[row.id]

        return (
          <XStack
            key={row.id}
            justifyContent="space-between"
            alignItems="center"
            paddingVertical="$2"
          >
            <Text fontFamily="$body" fontSize={15} color="$color">
              {row.label}
            </Text>

            {isRecording ? (
              <XStack gap="$2" alignItems="center">
                <Text fontFamily="$body" fontSize={13} color="$color7" fontStyle="italic">
                  Press a key…
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={16}
                  color="$color8"
                  cursor="pointer"
                  onPress={() => {
                    recorder.cancelRecording()
                    setRecordingId(null)
                  }}
                >
                  ×
                </Text>
              </XStack>
            ) : (
              <XStack gap="$3" alignItems="center">
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$color"
                  borderWidth={1}
                  borderColor="$color5"
                  borderRadius={4}
                  paddingHorizontal={6}
                  paddingVertical={2}
                  cursor="pointer"
                  hoverStyle={{ borderColor: '$color8' }}
                  onPress={() => {
                    recorder.startRecording()
                    setRecordingId(row.id)
                  }}
                >
                  {formatHotkeyDisplay(currentBinding)}
                </Text>
                {showReset && (
                  <Text
                    fontFamily="$body"
                    fontSize={11}
                    color="$color8"
                    cursor="pointer"
                    hoverStyle={{ color: '$color' }}
                    onPress={() => resetHotkeyOverride(row.id)}
                  >
                    (reset)
                  </Text>
                )}
              </XStack>
            )}
          </XStack>
        )
      })}
    </YStack>
  )
}
