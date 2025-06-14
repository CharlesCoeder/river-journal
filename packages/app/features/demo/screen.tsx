'use client'

import React, { useState, useEffect } from 'react'
import {
  YStack,
  XStack,
  Button,
  Text,
  Input,
  Switch,
  SizableText,
  Separator,
  H2,
  Card,
  Paragraph,
} from '@my/ui'
import { observer } from '@legendapp/state/react'
import { demo$, resetDemo, forceSave, waitForDemoLoaded } from '../../state/demo/store'

// Wrap the component with observer to make it reactive
export const DemoScreen = observer(function DemoScreen() {
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const loadPersistence = async () => {
      await waitForDemoLoaded()
      setIsLoaded(true)
    }

    loadPersistence()
  }, [])

  // Show loading state while persistence is loading. Usually only shows happens if refreshing the page directly (versus having navigated there).
  if (!isLoaded) {
    return (
      <YStack gap="$4" p="$4" alignItems="center" justifyContent="center" minHeight={400}>
        <Text>Loading persisted data...</Text>
      </YStack>
    )
  }

  // Debug functions
  const handleCounterDecrement = () => {
    demo$.counter.set((c) => Math.max(0, c - 1))
  }

  const handleCounterIncrement = () => {
    demo$.counter.set((c) => c + 1)
  }

  const handleTextChange = (text: string) => {
    demo$.text.set(text)
  }

  const handleToggleChange = (value: boolean) => {
    demo$.toggleState.set(value)
  }

  const handleForceSave = () => {
    forceSave()
  }

  return (
    <YStack gap="$4" p="$4">
      <H2>Legend-State Demo</H2>
      <Paragraph>
        This demo showcases Legend-State's persistence capabilities. Make changes, then reload the
        app to see persistence in action.
      </Paragraph>

      <YStack gap="$4">
        <Card p="$4">
          <YStack gap="$2">
            <Text fontWeight="bold">Counter</Text>
            <XStack gap="$2" alignItems="center">
              <Button onPress={handleCounterDecrement}>-</Button>
              <SizableText fontSize="$6">{demo$.counter.get()}</SizableText>
              <Button onPress={handleCounterIncrement}>+</Button>
            </XStack>
          </YStack>
        </Card>

        <Card p="$4">
          <YStack gap="$2">
            <Text fontWeight="bold">Text Input</Text>
            <Input
              value={demo$.text.get()}
              onChangeText={handleTextChange}
              placeholder="Type something..."
            />
          </YStack>
        </Card>

        <Card p="$4">
          <YStack gap="$2">
            <Text fontWeight="bold">Toggle Switch</Text>
            <XStack gap="$2" alignItems="center">
              <Switch checked={demo$.toggleState.get()} onCheckedChange={handleToggleChange} />
              <Text>{demo$.toggleState.get() ? 'ON' : 'OFF'}</Text>
            </XStack>
          </YStack>
        </Card>

        {demo$.lastUpdated.get() && (
          <Card p="$4">
            <Text fontSize="$1">
              Last updated: {new Date(demo$.lastUpdated.get() || '').toLocaleString()}
            </Text>
          </Card>
        )}

        <Separator />

        <XStack gap="$4" justify="center">
          <Button variant="outlined" onPress={handleForceSave}>
            Force Save
          </Button>
          <Button
            variant="outlined"
            onPress={() => {
              resetDemo()
            }}
          >
            Reset Data
          </Button>
        </XStack>
      </YStack>
    </YStack>
  )
})
