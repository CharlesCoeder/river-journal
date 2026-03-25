import { YStack, XStack, Button, Dialog, Text, Spinner, isWeb } from '@my/ui'
import { ArrowLeft, Save } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { useState, useCallback } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { Editor } from './components/Editor'
import {
  store$,
  saveActiveFlowSession,
  getActiveFlowContent,
  hidePersistentEditor,
  updatePersistentEditorHeaderHeight,
} from 'app/state/store'
import { use$ } from '@legendapp/state/react'

export function JournalScreen() {
  const router = useRouter()
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const activeFlow = use$(store$.activeFlow)

  const handleBackToHome = () => {
    hidePersistentEditor()
    router.push('/')
  }

  const handleSaveFlow = () => {
    setIsSaving(true)
    saveActiveFlowSession()
    setIsSaving(false)
    setShowSaveDialog(false)
    hidePersistentEditor()
    router.replace('/journal/celebration')
  }

  const handleExitFlow = () => {
    const content = getActiveFlowContent()
    if (content.trim()) {
      setShowSaveDialog(true)
    } else {
      handleBackToHome()
    }
  }

  const handleHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    if (!isWeb) {
      updatePersistentEditorHeaderHeight(e.nativeEvent.layout.height)
    }
  }, [])

  const hasContent = !!activeFlow?.content

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      {/* Minimal header — back icon left, save icon right */}
      <XStack
        width="100%"
        justifyContent="space-between"
        alignItems="center"
        paddingHorizontal="$4"
        paddingTop="$2"
        paddingBottom="$3"
        zIndex={200}
        onLayout={handleHeaderLayout}
        $sm={{
          maxWidth: 720,
          alignSelf: 'center',
          paddingHorizontal: '$2',
        }}
      >
        <Button
          size="$3"
          chromeless
          onPress={handleBackToHome}
          icon={ArrowLeft}
          color="$color9"
          opacity={0.6}
          hoverStyle={{ opacity: 1 }}
        />
        <Button
          size="$3"
          chromeless
          onPress={handleExitFlow}
          icon={Save}
          color="$color9"
          opacity={hasContent ? 0.6 : 0.2}
          hoverStyle={{ opacity: hasContent ? 1 : 0.2 }}
          disabled={!hasContent}
        />
      </XStack>

      {/* Writing surface — maximized */}
      <YStack
        flex={1}
        width="100%"
        paddingHorizontal="$4"
        $sm={{
          maxWidth: 720,
          alignSelf: 'center',
          paddingHorizontal: '$2',
        }}
      >
        <Editor />
      </YStack>

      {/* Save dialog — warm, calm, centered */}
      <Dialog
        open={showSaveDialog || isSaving}
        onOpenChange={(open) => {
          if (!isSaving) setShowSaveDialog(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            key="overlay"
            animation="quick"
            opacity={0.4}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <Dialog.Content
            key="content"
            animateOnly={['transform', 'opacity']}
            animation={[
              'medium',
              {
                opacity: {
                  overshootClamping: true,
                },
              },
            ]}
            enterStyle={{ y: -10, opacity: 0 }}
            exitStyle={{ y: 10, opacity: 0 }}
            backgroundColor="$background"
            borderRadius="$6"
            padding="$6"
            gap="$4"
            maxWidth="90%"
            width="100%"
            $sm={{ maxWidth: 400 }}
            borderWidth={1}
            borderColor="$color5"
          >
            <Dialog.Title fontSize="$6" fontFamily="$body" fontWeight="600" color="$color">
              Save this flow?
            </Dialog.Title>
            <Dialog.Description fontSize="$4" fontFamily="$body" color="$color10">
              Your words will be saved and you can revisit them anytime.
            </Dialog.Description>

            <XStack gap="$3" justifyContent="flex-end" marginTop="$2">
              <Dialog.Close displayWhenAdapted asChild>
                <Button
                  variant="outlined"
                  onPress={() => setShowSaveDialog(false)}
                  disabled={isSaving}
                  borderColor="$color6"
                  borderRadius="$4"
                >
                  <Text fontSize="$4" fontFamily="$body" color="$color10">
                    Cancel
                  </Text>
                </Button>
              </Dialog.Close>
              <Button
                onPress={handleSaveFlow}
                theme="accent"
                disabled={isSaving}
                borderRadius="$4"
              >
                {isSaving ? (
                  <XStack gap="$2" alignItems="center">
                    <Spinner size="small" />
                    <Text fontSize="$4" fontFamily="$body" fontWeight="600">
                      Saving…
                    </Text>
                  </XStack>
                ) : (
                  <Text fontSize="$4" fontFamily="$body" fontWeight="600">
                    Save Flow
                  </Text>
                )}
              </Button>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </YStack>
  )
}
