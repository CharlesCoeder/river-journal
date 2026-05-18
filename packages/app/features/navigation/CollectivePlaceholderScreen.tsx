import { useEffect, useState } from 'react'
import { AnimatePresence, YStack, XStack, Text, ScrollView } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { WordLinkNav } from './WordLinkNav'

// Temporary stand-in shown at /collective while the real CollectiveFeedScreen is being
// re-styled. Restore the original route bodies in apps/{web,desktop}/app/collective/page.tsx
// and apps/mobile/app/collective.tsx to re-enable the real feature.

const GLIMPSES: ReadonlyArray<string> = [
  'Reach the day’s 500 words and a quiet door to Collective opens.',
  'Share a short reflection — only what you choose to share leaves your device.',
  'Read others gently. A calm, unhurried feed; no chasing, no live notifications.',
  'A small set of reactions, a thread of replies, and a soft way to flag what feels off.',
]

export function CollectivePlaceholderScreen() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        width="100%"
        maxWidth={1024}
        alignSelf="center"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={96}
        $sm={{ paddingHorizontal: '$6' }}
        $md={{ paddingHorizontal: '$8', paddingTop: '$8' }}
        $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
      >
        <WordLinkNav variant="browse" />

        <XStack
          justifyContent="space-between"
          alignItems="center"
          marginBottom={64}
          $md={{ marginBottom: 96 }}
        >
          <Text
            fontFamily="$journalItalic"
            fontStyle="italic"
            fontSize={30}
            color="$color"
          >
            Collective
          </Text>
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$color8"
            letterSpacing={0.5}
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={() => router.push('/')}
          >
            Back to Home
          </Text>
        </XStack>

        <AnimatePresence>
          {mounted && (
            <YStack
              key="collective-placeholder-body"
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 10 }}
              opacity={1}
              y={0}
              width="100%"
              maxWidth={680}
              gap="$8"
            >
          <YStack gap="$3">
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$color8"
              letterSpacing={1}
              textTransform="uppercase"
            >
              A quieter place to share
            </Text>
            <Text
              fontFamily="$journal"
              fontSize={36}
              color="$color"
              lineHeight={44}
            >
              Collective is taking shape.
            </Text>
          </YStack>

          <YStack gap="$4">
            <Text fontFamily="$body" fontSize="$5" color="$color" lineHeight={28}>
              Your journal is private by default. Collective is a small, calm
              space where you can choose to share a few words from your day —
              and read what others have chosen to share, too.
            </Text>
            <Text fontFamily="$body" fontSize="$4" color="$color9" lineHeight={24}>
              It’s here, working quietly behind the scenes. We’re still
              softening the edges before opening it up. In the meantime, you
              can keep writing — the rest of the journal is yours to use as
              normal.
            </Text>
          </YStack>

          <YStack gap="$3">
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$color8"
              letterSpacing={1}
              textTransform="uppercase"
            >
              What it’ll feel like
            </Text>
            <YStack gap="$3">
              {GLIMPSES.map((line) => (
                <XStack key={line} gap="$3" alignItems="flex-start">
                  <Text fontFamily="$body" fontSize="$4" color="$color8" minWidth={16}>
                    •
                  </Text>
                  <Text fontFamily="$body" fontSize="$4" color="$color" lineHeight={24} flex={1}>
                    {line}
                  </Text>
                </XStack>
              ))}
            </YStack>
          </YStack>
            </YStack>
          )}
        </AnimatePresence>
      </YStack>
    </ScrollView>
  )
}

export default CollectivePlaceholderScreen
