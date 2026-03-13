import {
  YStack,
  H1,
  Button,
  Text,
  ThemeSwitcher,
  XStack,
  Separator,
  Card,
  ScrollView,
} from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { syncState } from '@legendapp/state'
import { store$ } from 'app/state/store'
import { flows$ } from 'app/state/flows'
import { entries$ } from 'app/state/entries'
import { isSyncReady$ } from 'app/state/syncConfig'
import { signOut } from 'app/utils'
import { useCallback, useState } from 'react'
import { LinkedProviders } from 'app/features/auth/components/LinkedProviders'
import { EncryptionModeDialog } from 'app/features/home/components/EncryptionModeDialog'
import { SyncToggle } from 'app/features/home/components/SyncToggle'
import { KeyringPrompt } from 'app/features/home/components/KeyringPrompt'
import { TrustBrowserPrompt } from 'app/features/home/components/TrustBrowserPrompt'
import { TrustedBrowsersList } from 'app/features/home/components/TrustedBrowsersList'
import { OrphanFlowsDialog } from 'app/features/home/components/OrphanFlowsDialog'
import { encryptionSetup$ } from 'app/state/encryptionSetup'

function DevSyncIndicator() {
  if (process.env.NODE_ENV !== 'development') return null

  const syncEnabled = use$(store$.session.syncEnabled)
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const isSyncReady = use$(isSyncReady$)
  const flowsSyncState = use$(syncState(flows$))
  const entriesSyncState = use$(syncState(entries$))

  const dot = (on: boolean) => (on ? '🟢' : '🔴')

  return (
    <Card bordered padding="$3" backgroundColor="$backgroundHover" width="100%">
      <YStack gap="$1">
        <Text fontSize="$2" fontFamily="$body" fontWeight="700" color="$color11">
          DEV SYNC STATUS
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(syncEnabled)} env flag (syncEnabled): {String(syncEnabled)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(isAuthenticated)} isAuthenticated: {String(isAuthenticated)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(isSyncReady)} isSyncReady$ (gate open): {String(isSyncReady)}
        </Text>
        <Separator marginVertical="$1" />
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(!!flowsSyncState?.isPersistLoaded)} flows persist loaded:{' '}
          {String(!!flowsSyncState?.isPersistLoaded)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(!!flowsSyncState?.isSyncEnabled)} flows sync enabled:{' '}
          {String(!!flowsSyncState?.isSyncEnabled)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {flowsSyncState?.error ? `❌ flows error: ${flowsSyncState.error}` : '✅ flows: no error'}
        </Text>
        <Separator marginVertical="$1" />
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(!!entriesSyncState?.isPersistLoaded)} entries persist loaded:{' '}
          {String(!!entriesSyncState?.isPersistLoaded)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {dot(!!entriesSyncState?.isSyncEnabled)} entries sync enabled:{' '}
          {String(!!entriesSyncState?.isSyncEnabled)}
        </Text>
        <Text fontSize="$2" fontFamily="$body" color="$color11">
          {entriesSyncState?.error
            ? `❌ entries error: ${entriesSyncState.error}`
            : '✅ entries: no error'}
        </Text>
      </YStack>
    </Card>
  )
}

export function HomeScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const email = use$(store$.session.email)
  const userId = use$(store$.session.userId)
  const currentMode = use$(encryptionSetup$.currentMode)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleJournalScreen = () => {
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
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ flexGrow: 1 }}>
      <YStack
        width="100%"
        maxWidth="100%"
        backgroundColor="$background"
        gap="$4"
        flex={1}
        alignItems="flex-start"
        justifyContent="flex-start"
        alignSelf="flex-start"
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
        {/* Auth Status / Login Button - Temporary placement */}
        <XStack width="100%" justifyContent="flex-end">
          {isAuthenticated ? (
            <XStack gap="$3" alignItems="center">
              <Text fontSize="$3" fontFamily="$body" color="$color11">
                {email}
              </Text>
              <Button size="$3" variant="outlined" onPress={handleLogout} disabled={isLoggingOut}>
                <Text fontSize="$3" fontFamily="$body">
                  {isLoggingOut ? 'Logging out...' : 'Log out'}
                </Text>
              </Button>
            </XStack>
          ) : (
            <Button size="$3" onPress={handleLogin}>
              <Text fontSize="$3" fontFamily="$body">
                Log in
              </Text>
            </Button>
          )}
        </XStack>

        <YStack>
          <H1 size="$11" fontFamily="$body">
            River Journal
          </H1>
          <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700">
            This will be the home page!
          </Text>
          <Button onPress={handleJournalScreen} width="100%" $sm={{ width: 'auto' }}>
            <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700">
              Journal Screen
            </Text>
          </Button>
          <Button onPress={handleReadJournal} width="100%" $sm={{ width: 'auto' }}>
            <Text fontSize="$6" fontFamily="$sourceSans3" fontWeight="700">
              Read Journal
            </Text>
          </Button>
          <ThemeSwitcher />
        </YStack>

        {/* Authenticated features section */}
        {isAuthenticated && (
          <YStack width="100%" gap="$4">
            <Separator width="100%" />
            <LinkedProviders />

            <Separator width="100%" />
            <SyncToggle />
            <KeyringPrompt />
            <TrustBrowserPrompt />

            {currentMode === 'e2e' && userId && (
              <>
                <Separator width="100%" />
                <TrustedBrowsersList userId={userId} />
              </>
            )}
          </YStack>
        )}

        {/* Orphan flows consent dialog — self-managing, renders when orphanFlowsPending$ is non-null */}
        <EncryptionModeDialog />
        <OrphanFlowsDialog />

        <Separator width="100%" />
        <DevSyncIndicator />
      </YStack>
    </ScrollView>
  )
}
