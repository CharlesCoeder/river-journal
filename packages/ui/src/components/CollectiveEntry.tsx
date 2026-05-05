import { Text } from 'tamagui'

export interface CollectiveEntryProps {
  state?: 'dim' | 'lit'
  onPress: () => void
}

export function CollectiveEntry({ state = 'dim', onPress }: CollectiveEntryProps) {
  // TODO: If 'lit' grows into a state machine (lit/unread/active),
  // refactor to a discriminated union. Do not extend the string union past 3 cases.
  if (state === 'lit') {
    // TODO: lit-state styling — dot indicator? Color? Tap target?
    return (
      <Text
        fontFamily="$body"
        fontSize="$3"
        color="$color8"
        textTransform="uppercase"
        letterSpacing={2}
        cursor="pointer"
        onPress={onPress}
        aria-label="Collective"
        role="button"
      >
        COLLECTIVE
      </Text>
    )
  }

  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      color="$color8"
      textTransform="uppercase"
      letterSpacing={2}
      cursor="pointer"
      onPress={onPress}
      aria-label="Collective, locked"
      role="button"
    >
      COLLECTIVE
    </Text>
  )
}
