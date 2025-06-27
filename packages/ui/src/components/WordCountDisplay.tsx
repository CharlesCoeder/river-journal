import React from 'react'
import { XStack, YStack, Text } from '@my/ui'

interface WordCountDisplayProps {
  currentCount: number
  dailyTarget: number
}

export function WordCountDisplay({ currentCount, dailyTarget }: WordCountDisplayProps) {
  const progressPercentage = Math.min((currentCount / dailyTarget) * 100, 100)
  const isComplete = currentCount >= dailyTarget

  return (
    <YStack
      gap="$2"
      padding="$3"
      backgroundColor="$background"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
    >
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontSize="$3" fontWeight="600" color="$color">
          Daily Progress
        </Text>
        <Text fontSize="$2">{Math.round(progressPercentage)}%</Text>
      </XStack>

      <XStack justifyContent="space-between" alignItems="baseline">
        <Text fontSize="$6" fontWeight="700" color={isComplete ? 'green' : undefined}>
          {currentCount}
        </Text>
        <Text fontSize="$3">/ {dailyTarget} words</Text>
      </XStack>

      {/* Simple progress bar using text format */}
      <XStack gap="$1" alignItems="center">
        <Text fontSize="$2">
          {isComplete ? '✓ Target reached!' : `${dailyTarget - currentCount} words to go`}
        </Text>
      </XStack>
    </YStack>
  )
}
