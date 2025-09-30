import { YStack, XStack, H1, Button, Dialog, Text } from '@my/ui'
import { ArrowLeft, Save } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { useState } from 'react'
import { Editor } from './components/Editor'
import { store$, saveActiveFlowSession, getActiveFlowContent } from 'app/state/store'
import { use$ } from '@legendapp/state/react'

export function JournalScreen() {
  const router = useRouter()
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const activeFlow = use$(store$.journal.activeFlow)

  const handleBackToHome = () => {
    router.push('/')
  }

  const handleSaveFlow = () => {
    saveActiveFlowSession()
    setShowSaveDialog(false)
    router.push('/')
  }

  const handleSaveAndReturn = () => {
    const content = getActiveFlowContent()
    if (content.trim()) {
      setShowSaveDialog(true)
    } else {
      handleBackToHome()
    }
  }

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
      <XStack
        gap="$4"
        alignItems="center"
        justifyContent="space-between"
        width="100%"
        flexWrap="wrap"
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
            <H1 size="$11" $xs={{ size: '$9' }} fontFamily="$patrickHand" numberOfLines={1}>
              River Journal
            </H1>
          </YStack>
        </XStack>
        <Button
          size="$3"
          circular
          onPress={handleSaveAndReturn}
          icon={Save}
          backgroundColor="$background"
          borderColor="$borderColor"
          opacity={activeFlow?.content ? 1 : 0.5}
          marginLeft="$2"
        />
      </XStack>
      <Editor />

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <Dialog.Portal>
          <Dialog.Overlay
            key="overlay"
            animation="slow"
            opacity={0.5}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <Dialog.Content
            bordered
            elevate
            key="content"
            animateOnly={['transform', 'opacity']}
            animation={[
              'quick',
              {
                opacity: {
                  overshootClamping: true,
                },
              },
            ]}
            enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.9 }}
            exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.95 }}
            gap="$4"
            padding="$6"
            maxWidth="90%"
            width="100%"
            $sm={{ maxWidth: 400 }}
          >
            <Dialog.Title fontSize="$7" fontFamily="$sourceSans3" fontWeight="700">
              Save Flow Session?
            </Dialog.Title>
            <Dialog.Description fontSize="$5" fontFamily="$sourceSans3">
              Are you sure you want to save this flow and return to home?
            </Dialog.Description>

            <XStack gap="$3" justifyContent="flex-end" marginTop="$4">
              <Dialog.Close displayWhenAdapted asChild>
                <Button
                  variant="outlined"
                  onPress={() => setShowSaveDialog(false)}
                  flexGrow={1}
                  $sm={{ flexGrow: 0 }}
                >
                  <Text fontSize="$4" fontFamily="$sourceSans3" fontWeight="600">
                    Cancel
                  </Text>
                </Button>
              </Dialog.Close>
              <Button
                onPress={handleSaveFlow}
                backgroundColor="$color9"
                color="$color1"
                flexGrow={1}
                $sm={{ flexGrow: 0 }}
              >
                <Text fontSize="$4" fontFamily="$sourceSans3" fontWeight="600">
                  Save Flow
                </Text>
              </Button>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </YStack>
  )
}
