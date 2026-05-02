import { Text } from 'tamagui'

export interface StreakChipProps {
  dayCount?: number
}

export function StreakChip({ dayCount }: StreakChipProps) {
  // Treat 0 as "no streak yet" — render placeholder. Story 2-7 will revisit this contract.
  const displayCount = dayCount != null && dayCount > 0 ? dayCount : undefined
  const text = displayCount != null ? `Day ${displayCount}` : 'Day —'
  const label = displayCount != null ? `Day ${displayCount} streak` : 'Day — streak'

  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      color="$color8"
      accessibilityLabel={label}
      // NOTE: 2-7 may revisit if chip becomes interactive. Changing role retrains screen-reader users — coordinate with a11y review.
      accessibilityRole="text"
    >
      {text}
    </Text>
  )
}
