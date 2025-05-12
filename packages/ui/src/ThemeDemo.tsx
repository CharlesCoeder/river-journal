import React, { useState } from 'react'
import { Button, Card, SizableText, Text, Theme, XStack, YStack, useThemeName } from 'tamagui'

export type ThemeVariant = 'base' | 'red' | 'blue' | 'green'

export const ThemeDemo = () => {
  const defaultThemeName = useThemeName()
  const [isDarkMode, setIsDarkMode] = useState(defaultThemeName.includes('dark'))
  const [themeVariant, setThemeVariant] = useState<ThemeVariant>('base')

  const baseTheme = isDarkMode ? 'dark' : 'light'
  const themeName = themeVariant === 'base' ? baseTheme : themeVariant

  // Custom button color theme buttons using palette indices
  const themeButtons = [
    { value: 'base', label: 'B', bg: undefined },
    { value: 'red', label: 'R', bg: '$9' },
    { value: 'blue', label: 'B', bg: '$9' },
    { value: 'green', label: 'G', bg: '$9' },
  ]

  return (
    <Theme name={baseTheme}>
      <Card
        width={350}
        minHeight={400}
        borderRadius={16}
        borderWidth={1}
        borderColor="$borderColor"
        bg="$background"
        p={20}
        alignSelf="center"
      >
        <SizableText size="$6" fontWeight="bold" mb={20}>
          Theme Demo
        </SizableText>

        {/* Controls */}
        <YStack mb={20} gap={12}>
          <Button onPress={() => setIsDarkMode(!isDarkMode)} width="100%">
            {isDarkMode ? 'Dark Mode' : 'Light Mode'}
          </Button>

          <XStack gap={8} style={{ justifyContent: 'space-between' }}>
            {themeButtons.map((item) => (
              <Theme name={item.value === 'base' ? undefined : item.value} key={item.value}>
                <Button
                  onPress={() => setThemeVariant(item.value as ThemeVariant)}
                  bg={'$'}
                  color="white"
                  opacity={themeVariant === item.value ? 1 : 0.5}
                  width={40}
                  height={40}
                  circular
                >
                  {item.label}
                </Button>
              </Theme>
            ))}
          </XStack>
        </YStack>

        {/* Theme content demonstration */}
        <Theme name={themeVariant !== 'base' ? themeVariant : undefined}>
          <Card
            flex={1}
            bg="$background"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius={12}
            p={20}
          >
            <YStack flex={1} style={{ justifyContent: 'space-between' }}>
              <Text>
                This demo is using the <Text fontWeight="bold">{themeName}</Text> theme.
              </Text>

              <YStack gap={12}>
                <Button>Default Button</Button>
                <Button bg="$color" color={isDarkMode ? 'black' : 'white'}>
                  Themed Button
                </Button>
                <Text color="$color">Themed Text</Text>
              </YStack>
            </YStack>
          </Card>
        </Theme>
      </Card>
    </Theme>
  )
}
