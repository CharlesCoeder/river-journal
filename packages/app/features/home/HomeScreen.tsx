import {
  YStack,
  Text,
  Button,
  XStack,
  ScrollView,
} from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { signOut } from 'app/utils'
import { useCallback, useState } from 'react'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { getTodayJournalDayString } from 'app/state/date-utils'

export function HomeScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const email = use$(store$.session.email)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Today's writing progress
  const todayStats = use$(store$.views.statsByDate(getTodayJournalDayString()))
  const todayWords = todayStats?.totalWords || 0
  const flowCount = todayStats?.flows?.length || 0

  const handleBeginFlow = () => {
    router.push('/journal')
  }

  const handleReadJournal = () => {
    router.push('/day-view')
  }

  const handleLogin = () => {
    router.push('/auth')
  }

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await signOut()
    } finally {
      setIsLoggingOut(false)
    }
  }, [])

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        width="100%"
        flex={1}
        paddingHorizontal="$4"
        justifyContent="center"
        alignItems="center"
        $sm={{
          maxWidth: 640,
          alignSelf: 'center',
          paddingHorizontal: 0,
        }}
      >
        {/* Auth — quiet, top-right, absolute so it doesn't affect center layout */}
        <XStack
          position="absolute"
          top="$4"
          right="$4"
          $sm={{ top: '$6', right: 0 }}
        >
          {isAuthenticated ? (
            <XStack gap="$3" alignItems="center">
              <Text fontSize="$2" fontFamily="$body" color="$color9">
                {email}
              </Text>
              <Text
                fontSize="$2"
                fontFamily="$body"
                color="$color8"
                cursor="pointer"
                onPress={handleLogout}
                opacity={isLoggingOut ? 0.4 : 0.6}
                hoverStyle={{ opacity: 1 }}
              >
                {isLoggingOut ? 'Logging out…' : 'Log out'}
              </Text>
            </XStack>
          ) : (
            <Text
              fontSize="$2"
              fontFamily="$body"
              color="$color8"
              cursor="pointer"
              onPress={handleLogin}
              opacity={0.6}
              hoverStyle={{ opacity: 1 }}
            >
              Log in
            </Text>
          )}
        </XStack>

        {/* Hero — vertically centered, breathing, sanctuary */}
        <YStack
          alignItems="center"
          gap="$3"
          paddingBottom="$8"
        >
          {/* Title */}
          <Text
            fontSize="$11"
            fontFamily="$body"
            fontWeight="300"
            color="$color"
            textAlign="center"
            letterSpacing={-1}
            $sm={{ fontSize: '$12' }}
          >
            River Journal
          </Text>

          {/* Subtle encouragement or today's progress */}
          <Text
            fontSize="$4"
            fontFamily="$lora"
            fontStyle="italic"
            color="$color9"
            textAlign="center"
            paddingBottom="$6"
          >
            {todayWords > 0
              ? `${todayWords.toLocaleString()} words across ${flowCount} ${flowCount === 1 ? 'flow' : 'flows'} today`
              : 'Enter a flow. Write freely.'}
          </Text>

          {/* Primary CTA — Begin Flow */}
          <Button
            size="$5"
            themeInverse
            onPress={handleBeginFlow}
            paddingHorizontal="$10"
            borderRadius="$10"
            pressStyle={{ scale: 0.97 }}
          >
            <Text fontSize="$5" fontFamily="$body" fontWeight="600">
              Begin Flow
            </Text>
          </Button>

          {/* Secondary links */}
          <XStack gap="$4" paddingTop="$4">
            <Text
              fontSize="$3"
              fontFamily="$body"
              color="$color8"
              cursor="pointer"
              onPress={handleReadJournal}
              paddingVertical="$2"
              opacity={0.7}
              hoverStyle={{ opacity: 1 }}
            >
              Read Journal
            </Text>
            <Text
              fontSize="$3"
              fontFamily="$body"
              color="$color8"
              cursor="pointer"
              onPress={() => router.push('/settings')}
              paddingVertical="$2"
              opacity={0.7}
              hoverStyle={{ opacity: 1 }}
            >
              Settings
            </Text>
          </XStack>
        </YStack>
      </YStack>

      {/* Inline prompts & dialogs — self-managing, render when needed */}
      <KeyringPrompt />
      <EncryptionModeDialog />
      <OrphanFlowsDialog />
    </ScrollView>
  )
}
