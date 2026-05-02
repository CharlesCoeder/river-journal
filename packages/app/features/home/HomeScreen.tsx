import { AnimatePresence, YStack, Text, XStack, ScrollView } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useEffect, useState } from 'react'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { getTodayJournalDayString } from 'app/state/date-utils'
import { WordLinkNav } from 'app/features/navigation/WordLinkNav'

export function HomeScreen() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const todayStats = use$(store$.views.statsByDate(getTodayJournalDayString()))

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const handleBeginFlow = () => {
    router.push('/journal')
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      position="relative"
    >
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

                  {/* Word-link nav row (web/desktop wide viewports only) */}
                  <WordLinkNav variant="home" />
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

