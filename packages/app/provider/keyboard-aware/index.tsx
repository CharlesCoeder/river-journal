import type React from 'react'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { YStack } from '@my/ui'

interface KeyboardAwareContainerProps {
  children: React.ReactNode
  flex?: number
}

export function KeyboardAwareContainer({ children, flex = 1 }: KeyboardAwareContainerProps) {
  return (
    <KeyboardAwareScrollView
      style={{ flex }}
      bottomOffset={0}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack flex={1}>{children}</YStack>
    </KeyboardAwareScrollView>
  )
}
