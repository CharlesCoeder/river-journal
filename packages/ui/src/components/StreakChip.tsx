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
      aria-label={label}
      role="text"
    >
      {text}
    </Text>
  )
}
