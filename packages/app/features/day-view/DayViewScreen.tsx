import { YStack, XStack, H1, H2, Button, Text, Card, ScrollView, Separator } from '@my/ui'
import { ArrowLeft, ChevronLeft, ChevronRight, Calendar, Trash2 } from '@tamagui/lucide-icons'
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

  // Get the daily entry data for the selected date
  const dailyEntry = use$(store$.views.entryByDate(selectedDate))
  const dailyStats = use$(store$.views.statsByDate(selectedDate))

  // State for delete confirmation dialog (Story 1.2)
  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null)

  const handleBackToHome = () => {
    router.push('/')
  }

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

  /**
   * Handles confirmed deletion of a flow
   */
  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteFlow(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  /**
   * Navigates to journal for writing
   */
  const handleBeginFlow = () => {
    router.push('/journal')
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        flexGrow: 1,
      }}
    >
      <YStack
        width="100%"
        maxWidth="100%"
        marginLeft={0}
        backgroundColor="$background"
        gap="$4"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom="$8"
        $sm={{
          width: '75%',
          maxWidth: '75%',
          marginLeft: '12.5%',
          gap: '$8',
          paddingHorizontal: 0,
          paddingTop: '$8',
        }}
      >
        {/* Header with back button - Hidden on mobile */}
        <XStack
          gap="$4"
          alignItems="center"
          justifyContent="space-between"
          width="100%"
          display="none"
          $sm={{ display: 'flex' }}
        >
          <XStack gap="$4" alignItems="center" flex={1} minWidth={0}>
            <Button
              size="$3"
              circular
              onPress={handleBackToHome}
              icon={ArrowLeft}
              backgroundColor="$background"
              borderColor="$borderColor"
            />
            <YStack flex={1} minWidth={0}>
              <H1 size="$11" fontFamily="$body" numberOfLines={1}>
                Day View
              </H1>
            </YStack>
          </XStack>
        </XStack>

        {/* Date Navigation */}
        <XStack
          gap="$4"
          alignItems="center"
          justifyContent="space-between"
          width="100%"
          flexWrap="wrap"
        >
          <XStack
            gap="$2"
            alignItems="center"
            flex={1}
            justifyContent="center"
            $sm={{
              flex: 1,
              justifyContent: 'center',
            }}
          >
            {/* Back button on mobile only - placed before date navigation */}
            <Button
              size="$3"
              circular
              onPress={handleBackToHome}
              icon={ArrowLeft}
              backgroundColor="$background"
              borderColor="$borderColor"
              display="flex"
              $sm={{ display: 'none' }}
            />
            <Button
              size="$3"
              circular
              onPress={handlePreviousDay}
              icon={ChevronLeft}
              backgroundColor="$background"
              borderColor="$borderColor"
            />
            <Text
              fontSize="$5"
              fontFamily="$sourceSans3"
              fontWeight="600"
              textAlign="center"
              paddingHorizontal="$3"
              numberOfLines={1}
              minWidth={200}
              $sm={{
                fontSize: '$6',
                minWidth: 280,
              }}
            >
              {formatDate(selectedDate)}
            </Text>
            <Button
              size="$3"
              circular
              onPress={handleNextDay}
              icon={ChevronRight}
              backgroundColor="$background"
              borderColor="$borderColor"
            />
          </XStack>
          <Button
            size="$3"
            onPress={handleToday}
            icon={Calendar}
            backgroundColor="$background"
            borderColor="$borderColor"
          >
            <Text fontSize="$4" fontFamily="$sourceSans3" fontWeight="600">
              Today
            </Text>
          </Button>
        </XStack>

        {/* Daily Stats Card */}
        <Card
          bordered
          elevate
          width="100%"
          padding="$3"
          $sm={{ padding: '$4' }}
          backgroundColor="$background"
          borderColor="$borderColor"
        >
          <YStack gap="$2">
            <Text
              fontSize="$3"
              $sm={{ fontSize: '$4' }}
              fontFamily="$sourceSans3"
              fontWeight="700"
              color="$color"
            >
              Daily Summary
            </Text>
            <XStack gap="$4" $sm={{ gap: '$6' }} flexWrap="wrap">
              <YStack>
                <Text
                  fontSize="$2"
                  $sm={{ fontSize: '$3' }}
                  fontFamily="$sourceSans3"
                  color="$gray11"
                >
                  Total Words
                </Text>
                <Text
                  fontSize="$6"
                  $sm={{ fontSize: '$7' }}
                  fontFamily="$sourceSans3"
                  fontWeight="700"
                  color="$color"
                >
                  {dailyStats?.totalWords || 0}
                </Text>
              </YStack>
              <YStack>
                <Text
                  fontSize="$2"
                  $sm={{ fontSize: '$3' }}
                  fontFamily="$sourceSans3"
                  color="$gray11"
                >
                  Goal
                </Text>
                <Text
                  fontSize="$6"
                  $sm={{ fontSize: '$7' }}
                  fontFamily="$sourceSans3"
                  fontWeight="700"
                  color="$color"
                >
                  {store$.profile.word_goal.get() || 750}
                </Text>
              </YStack>
              <YStack>
                <Text
                  fontSize="$2"
                  $sm={{ fontSize: '$3' }}
                  fontFamily="$sourceSans3"
                  color="$gray11"
                >
                  Flow Sessions
                </Text>
                <Text
                  fontSize="$6"
                  $sm={{ fontSize: '$7' }}
                  fontFamily="$sourceSans3"
                  fontWeight="700"
                  color="$color"
                >
                  {dailyStats?.flows?.length || 0}
                </Text>
              </YStack>
              <YStack>
                <Text
                  fontSize="$2"
                  $sm={{ fontSize: '$3' }}
                  fontFamily="$sourceSans3"
                  color="$gray11"
                >
                  Progress
                </Text>
                <Text
                  fontSize="$6"
                  $sm={{ fontSize: '$7' }}
                  fontFamily="$sourceSans3"
                  fontWeight="700"
                  color="$color"
                >
                  {Math.round((dailyStats?.progress || 0) * 100)}%
                </Text>
              </YStack>
            </XStack>
          </YStack>
        </Card>

        {/* Flows List */}
        <YStack gap="$3" $sm={{ gap: '$4' }} width="100%">
          <H2 size="$7" $sm={{ size: '$8' }} fontFamily="$sourceSans3" fontWeight="700">
            Flow Sessions
          </H2>

          {!dailyEntry || dailyEntry.flows.length === 0 ? (
            <Card
              bordered
              padding="$4"
              $sm={{ padding: '$6' }}
              backgroundColor="$background"
              borderColor="$borderColor"
              width="100%"
            >
              <YStack gap="$4" alignItems="center">
                <Text
                  fontSize="$5"
                  $sm={{ fontSize: '$6' }}
                  fontFamily="$sourceSans3"
                  fontWeight="600"
                  color="$color"
                  textAlign="center"
                >
                  Ready to write?
                </Text>
                <Text
                  fontSize="$3"
                  $sm={{ fontSize: '$4' }}
                  fontFamily="$sourceSans3"
                  color="$gray11"
                  textAlign="center"
                >
                  Start a flow session and let your thoughts take shape.
                </Text>
                <Button size="$4" themeInverse onPress={handleBeginFlow} marginTop="$2">
                  <Text fontFamily="$sourceSans3" fontWeight="600">
                    Begin Flow
                  </Text>
                </Button>
              </YStack>
            </Card>
          ) : (
            <YStack gap="$3" $sm={{ gap: '$4' }}>
              {dailyEntry.flows
                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                .map((flow: Flow, index: number) => (
                  <Card
                    key={flow.id}
                    bordered
                    elevate
                    padding="$3"
                    $sm={{ padding: '$4' }}
                    backgroundColor="$background"
                    borderColor="$borderColor"
                    width="100%"
                  >
                    <YStack gap="$3">
                      <XStack justifyContent="space-between" alignItems="center">
                        <Text fontSize="$3" fontFamily="$sourceSans3" color="$gray11">
                          Flow #{index + 1}
                        </Text>
                        <Text fontSize="$3" fontFamily="$sourceSans3" color="$gray11">
                          {formatTime(flow.timestamp)}
                        </Text>
                      </XStack>

                      <Separator borderColor="$borderColor" />

                      <Text fontSize="$4" fontFamily="$sourceSans3" lineHeight="$5" color="$color">
                        {flow.content}
                      </Text>

                      <XStack justifyContent="space-between" alignItems="center" marginTop="$2">
                        <Text fontSize="$3" fontFamily="$sourceSans3" color="$gray11">
                          {flow.wordCount} {flow.wordCount === 1 ? 'word' : 'words'}
                        </Text>
                        <Button
                          size="$2"
                          circular
                          chromeless
                          icon={Trash2}
                          onPress={() => setDeleteTarget(flow)}
                          opacity={0.6}
                          hoverStyle={{ opacity: 1 }}
                          pressStyle={{ opacity: 1 }}
                        />
                      </XStack>
                    </YStack>
                  </Card>
                ))}
            </YStack>
          )}
        </YStack>
      </YStack>

      {/* Delete Confirmation Dialog */}
      <DeleteFlowDialog
        flow={deleteTarget}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </ScrollView>
  )
}
