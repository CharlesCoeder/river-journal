import { useRef, useEffect } from 'react'
import { AnimatePresence, Text } from 'tamagui'
import { useReducedMotion } from '../hooks/useReducedMotion'

export interface StreakChipProps {
  dayCount?: number
  state?: 'pending' | 'active'
}

export function StreakChip({ dayCount, state = 'pending' }: StreakChipProps) {
  const prevRef = useRef<number | undefined>(undefined)
  const reducedMotion = useReducedMotion()

  const text = dayCount !== undefined ? `Day ${dayCount}` : 'Day —'
  const label = dayCount !== undefined ? `Day ${dayCount} streak` : 'Day — streak'
  const color = state === 'active' ? '$color' : '$color8'

  const shouldAnimate =
    prevRef.current !== undefined &&
    dayCount !== undefined &&
    dayCount > prevRef.current

  const transition = shouldAnimate ? (reducedMotion ? '100ms' : 'designEnter') : undefined
  const enterStyle = shouldAnimate ? { opacity: 0, scale: 0.92 } : undefined

  useEffect(() => {
    prevRef.current = dayCount
  }, [dayCount])

  return (
    <AnimatePresence>
      <Text
        key={dayCount ?? 'placeholder'}
        fontFamily="$body"
        fontSize="$3"
        color={color}
        aria-label={label}
        role="text"
        transition={transition as any}
        enterStyle={enterStyle as any}
      >
        {text}
      </Text>
    </AnimatePresence>
  )
}
