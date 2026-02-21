import { YStack, H1, Button, Text, ThemeSwitcher, XStack, Separator } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { signOut } from 'app/utils'
import { useCallback, useState } from 'react'
import { LinkedProviders } from 'app/features/auth/components/LinkedProviders'

export function HomeScreen() {
  const router = useRouter()
  const isAuthenticated = use$(store$.session.isAuthenticated)
  const email = use$(store$.session.email)
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
    <YStack
      width="75%"
      maxWidth="75%"
      backgroundColor="$background"
      gap="$8"
      flex={1}
      alignItems="flex-start"
      justifyContent="flex-start"
      alignSelf="flex-start"
      marginLeft="12.5%"
      paddingTop="$8"
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

      {/* Linked Accounts — visible when logged in */}
      {isAuthenticated && (
        <>
          <Separator width="100%" />
          <LinkedProviders />
        </>
      )}
    </YStack>
  )
}
