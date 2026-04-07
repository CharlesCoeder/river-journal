import { AnimatePresence, YStack, Text, XStack, ScrollView } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { signOut } from 'app/utils'
import { useCallback, useEffect, useState } from 'react'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { getTodayJournalDayString } from 'app/state/date-utils'

export function HomeScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const email = use$(store$.session.email)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const todayStats = use$(store$.views.statsByDate(getTodayJournalDayString()))
  const todayWords = todayStats?.totalWords || 0
  const hasHistory = todayWords > 0 || (todayStats?.flows?.length || 0) > 0

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const handleBeginFlow = () => {
    router.push('/journal')
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
    <YStack
      flex={1}
      backgroundColor="$background"
      position="relative"
    >
      {/* Auth indicator — positioned relative to full viewport */}
      <XStack
        position="absolute"
        top={48}
        right={48}
        zIndex={10}
        $sm={{ top: 32, right: 32 }}
        transition="designEnter"
        opacity={mounted ? 1 : 0}
        y={mounted ? 0 : 15}
      >
        {isAuthenticated ? (
          <Text
            fontFamily="$body"
            fontSize={10}
            letterSpacing={3}
            color="$color7"
            textTransform="uppercase"
          >
            {email}
          </Text>
        ) : (
          <Text
            fontFamily="$body"
            fontSize={10}
            letterSpacing={3}
            color="$color7"
            textTransform="uppercase"
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={handleLogin}
          >
            Log in
          </Text>
        )}
      </XStack>

      <ScrollView
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <AnimatePresence>
          {mounted && (
            <YStack
              key="home-content"
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 15 }}
              opacity={1}
              y={0}
              width="100%"
              flex={1}
              maxWidth={1024}
              alignSelf="center"
              paddingHorizontal="$4"
              justifyContent="center"
              alignItems="flex-start"
              $sm={{ paddingHorizontal: '$6' }}
              $md={{ paddingHorizontal: '$8' }}
              $lg={{ paddingHorizontal: '$12' }}
            >
              {/* Content — left-aligned, generous spacing */}
              <YStack
                gap={96}
                width="100%"
              >
                {/* Date display */}
                <YStack gap="$5">
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    color="$color8"
                    letterSpacing={1}
                    textTransform="uppercase"
                  >
                    Today
                  </Text>
                  <Text
                    fontFamily="$journal"
                    fontSize={60}
                    $sm={{ fontSize: 48 }}
                    color="$color"
                    letterSpacing={-1}
                    lineHeight={68}
                    $sm={{ lineHeight: 56 }}
                  >
                    {today}.
                  </Text>
                </YStack>

                {/* Action area */}
                <XStack
                  flexWrap="wrap"
                  alignItems="baseline"
                  gap="$6"
                >
                  {/* Primary CTA — serif italic underline */}
                  <BeginWritingCTA onPress={handleBeginFlow} />

                  {/* Secondary links */}
                  <XStack gap="$4">
                    <Text
                      fontFamily="$body"
                      fontSize={14}
                      color="$color8"
                      letterSpacing={0.5}
                      cursor="pointer"
                      hoverStyle={{ color: '$color' }}
                      onPress={() => router.push('/day-view')}
                    >
                      Past Entries
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize={14}
                      color="$color8"
                      letterSpacing={0.5}
                      cursor="pointer"
                      hoverStyle={{ color: '$color' }}
                      onPress={() => router.push('/settings')}
                    >
                      Preferences
                    </Text>
                  </XStack>
                </XStack>
              </YStack>
            </YStack>
          )}
        </AnimatePresence>

        <KeyringPrompt />
        <OrphanFlowsDialog />
      </ScrollView>
      <EncryptionModeDialog />
    </YStack>
  )
}

/** State-driven CTA so the spring animation works in production (not CSS-extracted) */
function BeginWritingCTA({ onPress }: { onPress: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <Text
      fontFamily="$journalItalic"
      fontStyle="italic"
      fontSize={36}
      $sm={{ fontSize: 30 }}
      color="$color"
      cursor="pointer"
      transition="ctaSpring"
      x={hovered ? 5 : 0}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
    >
      Begin writing
    </Text>
  )
}

