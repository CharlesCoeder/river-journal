import {
  AnimatePresence,
  YStack,
  XStack,
  Dialog,
  Text,
  View,
  isWeb,
  ExpandingLineButton,
  WordCounter,
  useReducedMotion,
} from '@my/ui'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { useState, useCallback, useEffect } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { Editor } from './components/Editor'
import { KeyboardOffsetView } from './components/KeyboardOffsetView'
import { useTrackKeyboardHeight } from './hooks/useTrackKeyboardHeight'
import {
  store$,
  ephemeral$,
  saveActiveFlowSession,
  getActiveFlowContent,
  hidePersistentEditor,
  updatePersistentEditorHeaderHeight,
  updatePersistentEditorBottomBarHeight,
  setFocusMode,
  hasReachedAutosaveCheckpoint,
} from 'app/state/store'
import { use$ } from '@legendapp/state/react'

export function JournalScreen() {
  const router = useRouter()
  const [showExitConfirmDialog, setShowExitConfirmDialog] = useState(false)
  const activeFlow = use$(store$.activeFlow)
  const reduceMotion = useReducedMotion()
  useTrackKeyboardHeight()

  // Focus mode — read with ?? false (acceptable at consumer site per story Dev Notes)
  const focusMode = use$(store$.profile?.editor?.focusMode) ?? false

  const handleBackToHome = () => {
    hidePersistentEditor()
    router.push('/')
  }

  const handleSaveFlow = () => {
    saveActiveFlowSession()
    setShowExitConfirmDialog(false)
    hidePersistentEditor()
    router.replace('/journal/celebration')
  }

  const handleConfirmExit = () => {
    setShowExitConfirmDialog(false)
    handleBackToHome()
  }

  const handleExitFlow = () => {
    const content = getActiveFlowContent()
    const wordCount = ephemeral$.instantWordCount.peek()
    const checkpoint = hasReachedAutosaveCheckpoint()
    if (!content.trim()) {
      // No content at all — exit straight to home, no dialog
      handleBackToHome()
      return
    }
    if (wordCount < 50 && !checkpoint) {
      setShowExitConfirmDialog(true)
      return
    }
    // ≥50 words OR checkpoint reached → save and celebrate
    handleSaveFlow()
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
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      {/* Writing surface — maximized, full-screen feel */}
      <AnimatePresence>
        {mounted && (
          <YStack
            key="journal-content"
            transition="designEnterSlow"
            enterStyle={{ opacity: 0 }}
            opacity={1}
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
            <Editor focusMode={focusMode} />
          </YStack>
        )}
      </AnimatePresence>

      {/* Bottom bar — word count + finish button */}
      <KeyboardOffsetView>
        <AnimatePresence>
          {hasContent && (
            <XStack
              key="bottom-bar"
              transition="designEnter"
              enterStyle={{ opacity: 0, y: 10 }}
              exitStyle={{ opacity: 0, y: 10 }}
              opacity={1}
              y={0}
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
                <XStack alignItems="center" gap="$3">
                  <ExpandingLineButton
                    size="default"
                    onPress={() => setFocusMode(!focusMode)}
                    aria-label="Toggle focus mode"
                    aria-pressed={focusMode}
                  >
                    {focusMode ? <EyeOff size={16} /> : <Eye size={16} />}
                  </ExpandingLineButton>
                  <WordCounter count={wordCount} />
                </XStack>

                <ExpandingLineButton
                  size="default"
                  onPress={handleExitFlow}
                >
                  Finish Session
                </ExpandingLineButton>
              </XStack>
            </XStack>
          )}
        </AnimatePresence>
      </KeyboardOffsetView>

      {/* Exit-confirm dialog — shown when tapping Finish Session with <50 words and no checkpoint */}
      <Dialog
        open={showExitConfirmDialog}
        onOpenChange={(open) => {
          setShowExitConfirmDialog(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            key="overlay"
            transition="quick"
            opacity={0.4}
            enterStyle={{ opacity: 0 }}
            exitStyle={{ opacity: 0 }}
          />
          <Dialog.Content
            key="content"
            animateOnly={['transform', 'opacity']}
            transition={reduceMotion ? '100ms' : 'designModal'}
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
              fontSize="$6"
              color="$color"
            >
              You've barely written
            </Dialog.Title>
            <Dialog.Description
              fontFamily="$body"
              fontSize="$3"
              color="$color8"
            >
              Exit without saving? Your words won't be kept.
            </Dialog.Description>

            <XStack
              gap="$4"
              justifyContent="flex-end"
              marginTop="$3"
            >
              <ExpandingLineButton
                size="default"
                onPress={() => setShowExitConfirmDialog(false)}
              >
                Cancel
              </ExpandingLineButton>
              <ExpandingLineButton
                size="default"
                onPress={handleConfirmExit}
              >
                Confirm
              </ExpandingLineButton>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </YStack>
  )
}
