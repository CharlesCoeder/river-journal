import { YStack, XStack, Dialog, Text, Spinner, View, isWeb } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useState, useCallback } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { Editor } from './components/Editor'
import {
  store$,
  ephemeral$,
  saveActiveFlowSession,
  getActiveFlowContent,
  getActiveFlowWordCount,
  hidePersistentEditor,
  updatePersistentEditorHeaderHeight,
  updatePersistentEditorBottomBarHeight,
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
      // Save directly and go to celebration — no confirmation dialog needed
      handleSaveFlow()
    } else {
      handleBackToHome()
    }
  }

  const handleHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    if (!isWeb) {
      updatePersistentEditorHeaderHeight(e.nativeEvent.layout.height)
    }
  }, [])

  const handleBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    if (!isWeb) {
      updatePersistentEditorBottomBarHeight(e.nativeEvent.layout.height)
    }
  }, [])

  // Use instant (non-debounced) word count so the bottom bar appears and
  // updates immediately as the user types, rather than lagging 300ms behind.
  const wordCount = use$(ephemeral$.instantWordCount)
  const hasContent = wordCount > 0 || !!activeFlow?.content

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      {/* Writing surface — maximized, full-screen feel */}
      <YStack
        flex={1}
        width="100%"
        maxWidth={896}
        alignSelf="center"
        paddingHorizontal="$4"
        $md={{ paddingHorizontal: '$8' }}
        $lg={{ paddingHorizontal: '$12' }}
      >
        {/* Top spacer — measured for persistent editor positioning on native */}
        <View
          height="$4"
          $md={{ height: '$8' }}
          $lg={{ height: '$12' }}
          onLayout={handleHeaderLayout}
        />
        <Editor />
      </YStack>

      {/* Bottom bar — word count + finish button */}
      {hasContent && (
        <XStack
          position={isWeb ? ('fixed' as any) : 'absolute'}
          bottom={0}
          left={0}
          right={0}
          paddingHorizontal="$4"
          paddingVertical="$5"
          $md={{ paddingHorizontal: '$8' }}
          onLayout={handleBottomBarLayout}
          $lg={{ paddingHorizontal: '$12' }}
          paddingBottom="$6"
          justifyContent="center"
          zIndex={100}
        >
          <XStack
            width="100%"
            maxWidth={768}
            justifyContent="space-between"
            alignItems="center"
          >
            <Text
              fontFamily="$body"
              fontSize={14}
              color="$color8"
              letterSpacing={0.5}
            >
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </Text>

            <XStack
              cursor="pointer"
              alignItems="center"
              gap="$2"
              group="finishBtn"
              onPress={handleExitFlow}
              flexShrink={0}
            >
              <Text
                fontFamily="$body"
                fontSize={14}
                color="$color"
                letterSpacing={0.5}
                hoverStyle={{ color: '$color' }}
                whiteSpace="nowrap"
                // RN doesn't bubble press from Text to parent XStack, so both need onPress.
                // stopPropagation prevents double-fire on web.
                onPress={(e) => { e.stopPropagation(); handleExitFlow(); }}
              >
                Finish Session
              </Text>
              <View
                width={16}
                height={1}
                backgroundColor="$color"
                $group-finishBtn-hover={{ width: 24 }}
                flexShrink={0}
              />
            </XStack>
          </XStack>
        </XStack>
      )}

      {/* Save dialog */}
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
            animation="designModal"
            enterStyle={{ y: -10, opacity: 0 }}
            exitStyle={{ y: 10, opacity: 0 }}
            backgroundColor="$background"
            borderRadius={2}
            padding="$6"
            gap="$4"
            maxWidth="90%"
            width="100%"
            $sm={{ maxWidth: 400 }}
            borderWidth={1}
            borderColor="$color4"
          >
            <Dialog.Title
              fontFamily="$journal"
              fontSize={24}
              color="$color"
            >
              Save this flow?
            </Dialog.Title>
            <Dialog.Description
              fontFamily="$body"
              fontSize={14}
              color="$color8"
            >
              Your words will be saved and you can revisit them anytime.
            </Dialog.Description>

            <XStack
              gap="$4"
              justifyContent="flex-end"
              marginTop="$3"
            >
              <Dialog.Close
                displayWhenAdapted
                asChild
              >
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  letterSpacing={3}
                  textTransform="uppercase"
                  color="$color8"
                  cursor="pointer"
                  hoverStyle={{ color: '$color' }}
                  onPress={() => setShowSaveDialog(false)}
                >
                  Cancel
                </Text>
              </Dialog.Close>
              <Text
                fontFamily="$body"
                fontSize={12}
                letterSpacing={3}
                textTransform="uppercase"
                color="$color"
                cursor="pointer"
                hoverStyle={{ opacity: 0.7 }}
                onPress={handleSaveFlow}
                borderBottomWidth={1}
                borderColor="$color5"
                paddingBottom={2}
              >
                {isSaving ? 'Saving...' : 'Save Flow'}
              </Text>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </YStack>
  )
}
