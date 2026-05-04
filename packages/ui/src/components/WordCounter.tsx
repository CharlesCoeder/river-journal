import { Text } from 'tamagui'

export interface WordCounterProps {
  count: number
}

export function WordCounter({ count }: WordCounterProps) {
  const color = count < 450 ? '$color8' : '$color'

  return (
    <Text
      fontFamily="$body"
      fontSize={14}
      color={color}
      letterSpacing={0.5}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      {count} {count === 1 ? 'word' : 'words'}
    </Text>
  )
}
