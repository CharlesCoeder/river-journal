'use client'

import { DemoScreen } from 'app/features/demo/screen'
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
      <DemoScreen />
    </YStack>
  )
}
