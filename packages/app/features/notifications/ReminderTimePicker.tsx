/**
 * ReminderTimePicker — a dependency-free, keyboard-accessible time-of-day
 * stepper for the streak-reminder send time.
 *
 * Deliberately built from `@my/ui` primitives (no `@react-native-community/
 * datetimepicker`, which would force another native prebuild) and fully
 * cross-platform. Works on a timezone-agnostic 24-hour `'HH:mm'` string — never
 * a `Date`. Each unit is a single focusable stepper: activating the hour
 * control advances the hour by one (wrapping 23 → 00); the minute control
 * advances by 15 minutes (wrapping 45 → 00), aligning with the streak cron's
 * 15-minute matching window.
 *
 * Each control carries an `accessibilityLabel` describing what it changes, so
 * the whole picker is operable by keyboard / screen reader.
 */

import { Text, XStack, ExpandingLineButton } from '@my/ui'

const MINUTE_STEP = 15

export interface ReminderTimePickerProps {
  /** Current value as a 24-hour `'HH:mm'` string. */
  value: string
  /** Called with the next `'HH:mm'` string whenever a control is activated. */
  onChange: (next: string) => void
}

function wrap(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo
}

function parse(value: string): { hour: number; minute: number } {
  const [hourPart, minutePart] = value.split(':')
  const hour = Number.parseInt(hourPart ?? '', 10)
  const minute = Number.parseInt(minutePart ?? '', 10)
  return {
    hour: Number.isFinite(hour) ? wrap(hour, 24) : 20,
    minute: Number.isFinite(minute) ? wrap(minute, 60) : 0,
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function ReminderTimePicker({ value, onChange }: ReminderTimePickerProps) {
  const { hour, minute } = parse(value)

  return (
    <XStack
      gap="$3"
      alignItems="center"
    >
      <ExpandingLineButton
        size="cta"
        accessibilityLabel="Reminder hour"
        onPress={() => onChange(`${pad(wrap(hour + 1, 24))}:${pad(minute)}`)}
      >
        {pad(hour)}
      </ExpandingLineButton>
      <Text
        fontFamily="$journal"
        fontSize={24}
        color="$color8"
      >
        :
      </Text>
      <ExpandingLineButton
        size="cta"
        accessibilityLabel="Reminder minute"
        onPress={() => onChange(`${pad(hour)}:${pad(wrap(minute + MINUTE_STEP, 60))}`)}
      >
        {pad(minute)}
      </ExpandingLineButton>
    </XStack>
  )
}

export default ReminderTimePicker
