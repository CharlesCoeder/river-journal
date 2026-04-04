/**
 * CelebrationScreen.tsx
 *
 * Design: centered "Well done." italic serif, word count, "Return" button
 * with expanding line, auth nudge (if logged out), separator, re-read section.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, YStack, Text, XStack, ScrollView, View } from '@my/ui'
import { ExpandingLineButton } from './components/ExpandingLineButton'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$, clearLastSavedFlow, clearActiveFlow } from 'app/state/store'
import { Editor } from './components/Editor'

export function CelebrationScreen() {
  const router = useRouter()
  const lastSavedFlow = use$(store$.lastSavedFlow)
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const [mounted, setMounted] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)

  useEffect(() => {
    clearActiveFlow()
    setMounted(true)
    const t = setTimeout(() => setShowCelebration(true), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!lastSavedFlow) {
      router.push('/')
    }
  }, [lastSavedFlow, router])

  const handleDismiss = () => {
    clearLastSavedFlow()
    router.push('/')
  }

  const handleCreateAccount = () => {
    router.push('/auth?tab=signup')
    // Clear after navigation to avoid the useEffect redirect to '/'
    setTimeout(() => clearLastSavedFlow(), 100)
  }

  if (!lastSavedFlow) {
    return null
  }

  const { wordCount, content } = lastSavedFlow

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {/* Hero section — takes full viewport height, centers "Well done." */}
      <AnimatePresence>
        {mounted && (
          <YStack
            key="celebration-content"
            transition="designEnterVerySlow"
            enterStyle={{ opacity: 0 }}
            opacity={1}
            width="100%"
            maxWidth={672}
            alignSelf="center"
            paddingHorizontal="$4"
            minHeight="100vh"
            justifyContent="center"
            alignItems="center"
            position="relative"
          >
        <AnimatePresence>
          {showCelebration && (
            <YStack
              key="celebration-center"
              transition="celebrationSpring"
              enterStyle={{ opacity: 0, y: 30 }}
              opacity={1}
              y={0}
              alignItems="center"
              gap="$6"
            >
              <Text
                fontFamily="$journalItalic"
                fontStyle="italic"
                fontSize={36}
                $sm={{ fontSize: 48 }}
                color="$color"
                letterSpacing={-1}
              >
                Well done.
              </Text>

              <Text
                fontFamily="$body"
                fontSize={14}
                color="$color8"
                letterSpacing={0.5}
              >
                You let{' '}
                <Text fontFamily="$body" color="$color" fontWeight="500" fontSize={14}>
                  {wordCount}
                </Text>{' '}
                words flow today.
              </Text>

              {/* Return button with expanding line */}
              <View marginTop={48}>
                <ExpandingLineButton label="Return" onPress={handleDismiss} lineWidth={16} lineHoverWidth={32} />
              </View>

              {/* Auth nudge — only when logged out */}
              {!isAuthenticated && (
                <YStack
                  marginTop={28}
                  width="100%"
                  maxWidth={384}
                  borderWidth={1}
                  borderColor="$color3"
                  borderRadius="$2"
                  padding="$5"
                  alignItems="center"
                  gap="$3"
                >
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    color="$color8"
                    textAlign="center"
                    lineHeight={20}
                  >
                    Your writing is saved on this device. Create an account to sync across devices and keep it safe.
                  </Text>
                  <XStack gap="$5" paddingTop="$2">
                    <Text
                      fontFamily="$body"
                      fontSize={9}
                      letterSpacing={2.5}
                      textTransform="uppercase"
                      color="$color7"
                      cursor="pointer"
                      hoverStyle={{ color: '$color8' }}
                      onPress={handleDismiss}
                    >
                      Dismiss
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize={9}
                      letterSpacing={2.5}
                      textTransform="uppercase"
                      color="$color"
                      cursor="pointer"
                      hoverStyle={{ opacity: 0.7 }}
                      borderBottomWidth={1}
                      borderColor="$color5"
                      paddingBottom={1}
                      onPress={handleCreateAccount}
                    >
                      Create Account
                    </Text>
                  </XStack>
                </YStack>
              )}
            </YStack>
          )}
        </AnimatePresence>

        {/* Scroll indicator — pinned to bottom of hero viewport */}
        <YStack
          position="absolute"
          bottom={40}
          left={0}
          right={0}
          alignItems="center"
          gap="$1"
          opacity={0.3}
        >
          <Text
            fontFamily="$body"
            fontSize={10}
            letterSpacing={2}
            textTransform="uppercase"
            color="$color8"
          >
            Your words
          </Text>
          <Text fontFamily="$body" fontSize={14} color="$color8">
            {'\u2193'}
          </Text>
        </YStack>
          </YStack>
        )}
      </AnimatePresence>

      {/* Re-read section — below the fold */}
      <YStack
        width="100%"
        maxWidth={672}
        alignSelf="center"
        paddingHorizontal="$4"
        paddingBottom={96}
      >
        <YStack
          borderTopWidth={1}
          borderColor="$color2"
          paddingTop="$6"
        >
          <Editor readOnly initialContent={content} />
        </YStack>
      </YStack>
    </ScrollView>
  )
}
