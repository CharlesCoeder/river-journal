'use client'

import { JournalScreen } from 'app/features/journal/screen'
import { YStack } from 'tamagui'

export default function Page() {
  return (
    <YStack
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        paddingTop: 32,
      }}
    >
      <JournalScreen />
    </YStack>
  )
}
