import { useCallback, useMemo, useState } from 'react'
import {
  AlertDialog,
  Button,
  ExpandingLineButton,
  ScrollView,
  Text,
  View,
  XStack,
  YStack,
} from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import {
  flows$,
  entries$,
  store$,
  restoreExcludedEntries,
  getLocallyExcludedEntries,
} from 'app/state/store'
import { queryClient } from 'app/state/queryClient'
import { collectiveEligibilityKey } from 'app/state/collective/eligibility'

function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={11}
      textTransform="uppercase"
      letterSpacing={2}
      color="$color8"
    >
      {children}
    </Text>
  )
}

function formatEntryDate(iso: string): string {
  // entryDate is YYYY-MM-DD (timezone-agnostic). Render as local-midnight to
  // dodge the off-by-one TZ bug fixed in 6d1d1b0.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function LocalOnlyEntriesScreen() {
  const router = useRouter()
  // Subscribe to flows$ + entries$ so the list re-derives when restores complete.
  use$(flows$)
  use$(entries$)
  const userId = use$(store$.session.userId)

  const summaries = useMemo(() => getLocallyExcludedEntries(), [])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleRestoreOne = useCallback(
    (entryId: string) => {
      if (!userId) return
      restoreExcludedEntries([entryId], userId)
      queryClient.invalidateQueries({ queryKey: collectiveEligibilityKey })
    },
    [userId]
  )

  const handleRestoreAll = useCallback(() => {
    if (!userId) return
    const ids = summaries.map((s) => s.entryId)
    if (ids.length === 0) return
    restoreExcludedEntries(ids, userId)
    queryClient.invalidateQueries({ queryKey: collectiveEligibilityKey })
    setConfirmOpen(false)
  }, [summaries, userId])

  const isEmpty = summaries.length === 0
  const canSync = !!userId
  const totalCount = summaries.length

  return (
    <View
      flex={1}
      backgroundColor="$background"
    >
      <ScrollView
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack
          testID="local-only-entries-screen"
          width="100%"
          maxWidth={768}
          alignSelf="center"
          paddingHorizontal="$4"
          paddingTop="$4"
          paddingBottom={96}
          $sm={{ paddingHorizontal: '$6' }}
          $md={{ paddingHorizontal: '$8', paddingTop: '$8' }}
          $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
          gap="$6"
        >
          <XStack
            justifyContent="space-between"
            alignItems="center"
          >
            <Text
              fontFamily="$journalItalic"
              fontStyle="italic"
              fontSize={30}
              color="$color"
              letterSpacing={-0.5}
            >
              Local-only entries
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
              Back to Settings
            </Text>
          </XStack>

          <Text
            fontFamily="$body"
            fontSize={14}
            color="$color8"
            lineHeight={22}
            maxWidth={560}
          >
            Entries below were marked local-only when you enabled sync. You can sync them now to
            count toward Collective eligibility. Content stays encrypted; only word counts become
            visible to the server.
          </Text>

          {!canSync && (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$color10"
              testID="local-only-entries-signed-out"
            >
              Sign in to recover entries.
            </Text>
          )}

          {isEmpty && (
            <Text
              fontFamily="$body"
              fontSize={14}
              color="$color8"
              testID="local-only-entries-empty"
            >
              Nothing to sync.
            </Text>
          )}

          {!isEmpty && (
            <>
              <XStack
                justifyContent="space-between"
                alignItems="center"
              >
                <SectionHeader>{`${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`}</SectionHeader>
                <ExpandingLineButton
                  size="default"
                  disabled={!canSync}
                  onPress={() => setConfirmOpen(true)}
                  accessibilityLabel="Sync all local-only entries"
                >
                  Sync all
                </ExpandingLineButton>
              </XStack>

              <YStack gap="$4">
                {summaries.map((s) => (
                  <XStack
                    key={s.entryId}
                    testID={`local-only-row-${s.entryId}`}
                    justifyContent="space-between"
                    alignItems="center"
                    paddingVertical="$3"
                    borderBottomWidth={1}
                    borderColor="$color3"
                  >
                    <YStack gap="$1">
                      <Text
                        fontFamily="$body"
                        fontSize={15}
                        color="$color"
                      >
                        {formatEntryDate(s.entryDate)}
                      </Text>
                      <Text
                        fontFamily="$body"
                        fontSize={12}
                        color="$color8"
                      >
                        {s.totalWordCount} {s.totalWordCount === 1 ? 'word' : 'words'}
                      </Text>
                    </YStack>
                    <ExpandingLineButton
                      size="default"
                      disabled={!canSync}
                      onPress={() => handleRestoreOne(s.entryId)}
                      accessibilityLabel={`Sync entry from ${s.entryDate}`}
                    >
                      Sync this entry
                    </ExpandingLineButton>
                  </XStack>
                ))}
              </YStack>
            </>
          )}
        </YStack>
      </ScrollView>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            key="overlay"
            transition="quick"
            opacity={0.4}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <AlertDialog.Content
            key="content"
            testID="local-only-confirm-dialog"
            transition={['medium', { opacity: { overshootClamping: true } }]}
            enterStyle={{ y: -10, opacity: 0 }}
            exitStyle={{ y: 10, opacity: 0 }}
            y={0}
            opacity={1}
            backgroundColor="$background"
            borderRadius="$6"
            borderWidth={1}
            borderColor="$color5"
            padding="$5"
            maxWidth={420}
            width="90%"
          >
            <YStack gap="$4">
              <AlertDialog.Title
                fontFamily="$body"
                fontSize="$6"
                fontWeight="700"
              >
                Sync {totalCount} {totalCount === 1 ? 'entry' : 'entries'}?
              </AlertDialog.Title>
              <AlertDialog.Description
                fontFamily="$body"
                fontSize="$4"
                color="$color"
              >
                Their word counts will become visible to the server. Content stays encrypted.
              </AlertDialog.Description>
              <XStack
                gap="$3"
                justifyContent="flex-end"
              >
                <AlertDialog.Cancel asChild>
                  <Button
                    variant="outlined"
                    fontFamily="$body"
                  >
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    onPress={handleRestoreAll}
                    fontFamily="$body"
                    testID="local-only-confirm-sync-all"
                  >
                    Sync all
                  </Button>
                </AlertDialog.Action>
              </XStack>
            </YStack>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog>
    </View>
  )
}
