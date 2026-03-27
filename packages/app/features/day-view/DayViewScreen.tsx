import { YStack, XStack, Text, ScrollView, View } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useState } from 'react'
import { use$ } from '@legendapp/state/react'
import { store$, deleteFlow } from 'app/state/store'
import { getTodayJournalDayString } from 'app/state/date-utils'
import type { Flow } from 'app/state/types'
import { DeleteFlowDialog } from './components/DeleteFlowDialog'

export function DayViewScreen() {
  const router = useRouter()
  const allEntries = use$(store$.views.allEntriesSorted())

  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null)

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteFlow(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      showsVerticalScrollIndicator={false}
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
        {/* Header */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom={64} $md={{ marginBottom: 96 }}>
          <Text
            fontFamily="$journalItalic"
            fontStyle="italic"
            fontSize={30}
            color="$color"
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
            onPress={() => router.push('/')}
          >
            Back to Home
          </Text>
        </XStack>

        {/* Entry list */}
        {(!allEntries || allEntries.length === 0) ? (
          <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={96}>
            <Text
              fontFamily="$journal"
              fontSize={20}
              color="$color8"
              fontStyle="italic"
            >
              No journals yet. The river is dry.
            </Text>
          </YStack>
        ) : (
          <YStack gap={64}>
            {allEntries.map((entry, index) => (
              <XStack
                key={entry.id}
                flexDirection="column"
                gap="$3"
                $md={{ flexDirection: 'row', gap: '$8' }}
                $lg={{ gap: '$12' }}
              >
                {/* Date column */}
                <YStack $md={{ width: 128 }} flexShrink={0} paddingTop={4}>
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    color="$color8"
                    letterSpacing={0.5}
                  >
                    {formatDate(entry.entryDate)}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    color="$color7"
                    marginTop="$1"
                  >
                    {entry.totalWords} words
                  </Text>
                </YStack>

                {/* Text column */}
                <YStack flex={1}>
                  {entry.flows
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                    .map((flow: Flow, fIndex: number) => (
                      <YStack key={flow.id} group onLongPress={() => setDeleteTarget(flow)}>
                        {fIndex > 0 && <View height={1} backgroundColor="$color3" marginVertical="$4" width={40} />}
                        <Text
                          fontFamily="$journal"
                          fontSize={20}
                          $md={{ fontSize: 24 }}
                          color="$color"
                          lineHeight={32}
                          $md={{ lineHeight: 38 }}
                        >
                          {flow.content}
                        </Text>
                      </YStack>
                    ))}
                </YStack>
              </XStack>
            ))}
          </YStack>
        )}
      </YStack>

      <DeleteFlowDialog
        flow={deleteTarget}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </ScrollView>
  )
}
