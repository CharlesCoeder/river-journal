import React from 'react'
import { Text } from 'tamagui'

interface WordCountDisplayProps {
  currentCount: number
  dailyTarget: number
}

export function WordCountDisplay({ currentCount }: WordCountDisplayProps) {
  const wordText = currentCount === 1 ? 'word' : 'words'

  return (
    <Text fontSize="$3" color="$color" fontWeight="400">
      {currentCount} {wordText}
    </Text>
  )
}
