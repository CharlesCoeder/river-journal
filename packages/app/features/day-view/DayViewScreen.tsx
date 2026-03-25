import { YStack, XStack, Button, Text, Separator, ScrollView } from '@my/ui'
import { ChevronLeft, ChevronRight, Calendar, Trash2 } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { useState } from 'react'
import { use$ } from '@legendapp/state/react'
import { store$, deleteFlow } from 'app/state/store'
import { getTodayJournalDayString } from 'app/state/date-utils'
import type { Flow } from 'app/state/types'
import { DeleteFlowDialog } from './components/DeleteFlowDialog'

export function DayViewScreen() {
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState<string>(getTodayJournalDayString())

  const dailyEntry = use$(store$.views.entryByDate(selectedDate))
  const dailyStats = use$(store$.views.statsByDate(selectedDate))

  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null)

  const handlePreviousDay = () => {
    const date = new Date(selectedDate)
    date.setDate(date.getDate() - 1)
    setSelectedDate(date.toISOString().split('T')[0])
  }

  const handleNextDay = () => {
    const date = new Date(selectedDate)
    date.setDate(date.getDate() + 1)
    setSelectedDate(date.toISOString().split('T')[0])
  }

  const handleToday = () => {
    setSelectedDate(getTodayJournalDayString())
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteFlow(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  const handleBeginFlow = () => {
    router.push('/journal')
  }

  const totalWords = dailyStats?.totalWords || 0
  const flowCount = dailyStats?.flows?.length || 0
  const progress = dailyStats?.progress || 0

  const today = getTodayJournalDayString()
  const isToday = selectedDate === today
  const isFuture = selectedDate > today

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        width="100%"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom="$10"
        $sm={{
          maxWidth: 640,
          alignSelf: 'center',
          paddingHorizontal: 0,
          paddingTop: '$6',
        }}
      >
        {/* Date navigation — the date IS the header */}
        <XStack
          alignItems="center"
          justifyContent="center"
          gap="$3"
          paddingBottom="$6"
        >
          <Button
            size="$3"
            chromeless
            onPress={handlePreviousDay}
            icon={ChevronLeft}
            color="$color9"
          />
          <Text
            fontSize="$6"
            fontFamily="$body"
            fontWeight="600"
            color="$color"
            textAlign="center"
            minWidth={220}
            $sm={{ fontSize: '$7', minWidth: 280 }}
          >
            {formatDate(selectedDate)}
          </Text>
          <Button
            size="$3"
            chromeless
            onPress={handleNextDay}
            icon={ChevronRight}
            color="$color9"
          />
          <Button
            size="$2"
            chromeless
            onPress={handleToday}
            icon={Calendar}
            color="$color9"
            opacity={0.6}
            hoverStyle={{ opacity: 1 }}
          />
        </XStack>

        {/* Daily stats — words as hero metric */}
        <XStack
          justifyContent="center"
          alignItems="baseline"
          gap="$3"
          paddingBottom="$2"
        >
          <Text
            fontSize="$9"
            fontFamily="$body"
            fontWeight="700"
            color="$color"
            $sm={{ fontSize: '$10' }}
          >
            {totalWords.toLocaleString()}
          </Text>
          <Text fontSize="$4" fontFamily="$body" color="$color10">
            {totalWords === 1 ? 'word' : 'words'}
          </Text>
        </XStack>

        <XStack justifyContent="center" gap="$6" paddingBottom="$6">
          <Text fontSize="$3" fontFamily="$body" color="$color10">
            {flowCount} {flowCount === 1 ? 'flow' : 'flows'}
          </Text>
          {progress > 0 && (
            <Text fontSize="$3" fontFamily="$body" color="$color10">
              {Math.round(progress * 100)}% of goal
            </Text>
          )}
        </XStack>

        <Separator borderColor="$color5" marginBottom="$6" />

        {/* Flow list */}
        {!dailyEntry || dailyEntry.flows.length === 0 ? (
          /* Empty state — varies by day */
          <YStack alignItems="center" gap="$4" paddingTop="$8" paddingBottom="$8">
            <Text
              fontSize="$5"
              fontFamily="$body"
              fontWeight="400"
              color="$color"
              textAlign="center"
            >
              {isFuture
                ? 'Nothing here yet'
                : isToday
                  ? 'Ready to write?'
                  : 'No flows on this day'}
            </Text>
            <Text
              fontSize="$3"
              fontFamily="$body"
              color="$color10"
              textAlign="center"
            >
              {isFuture
                ? 'This day hasn\u2019t arrived yet.'
                : isToday
                  ? 'Start a flow and let your thoughts take shape.'
                  : 'You didn\u2019t write anything on this day.'}
            </Text>
            {isToday && (
              <Button
                size="$5"
                theme="accent"
                onPress={handleBeginFlow}
                marginTop="$2"
                paddingHorizontal="$8"
                borderRadius="$6"
              >
                <Text fontSize="$5" fontFamily="$body" fontWeight="600">
                  Begin Flow
                </Text>
              </Button>
            )}
          </YStack>
        ) : (
          <YStack>
            {dailyEntry.flows
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .map((flow: Flow, index: number) => (
                <YStack key={flow.id} group onLongPress={() => setDeleteTarget(flow)}>
                  {/* Subtle divider between flows */}
                  {index > 0 && (
                    <YStack paddingVertical="$5">
                      <YStack width={40} height={1} backgroundColor="$color7" />
                    </YStack>
                  )}

                  {/* Flow metadata — minimal, faded, left-aligned */}
                  <XStack alignItems="center" gap="$2" paddingBottom="$2">
                    <Text fontSize="$1" fontFamily="$body" color="$color8" opacity={0.6}>
                      {formatTime(flow.timestamp)} · {flow.wordCount} {flow.wordCount === 1 ? 'word' : 'words'}
                    </Text>
                    <Button
                      size="$2"
                      chromeless
                      icon={Trash2}
                      onPress={() => setDeleteTarget(flow)}
                      color="$color8"
                      opacity={0}
                      $group-hover={{ opacity: 0.5 }}
                      hoverStyle={{ opacity: 0.7 }}
                      pressStyle={{ opacity: 1 }}
                    />
                  </XStack>

                  {/* Content — Lora serif, the focus */}
                  <Text
                    fontSize="$4"
                    fontFamily="$lora"
                    color="$color"
                    lineHeight={28}
                  >
                    {flow.content}
                  </Text>
                </YStack>
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
