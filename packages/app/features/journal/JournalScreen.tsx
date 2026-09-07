import { AnimatePresence, YStack, View, isWeb } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useState, useCallback, useEffect } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { useNavigateHome } from 'app/features/navigation/useNavigateHome'
import { Editor } from './components/Editor'
import { FlowSessionBottomBar, FlowExitConfirmDialog } from './components/FlowSessionChrome'
import { KeyboardOffsetView } from './components/KeyboardOffsetView'
import { useTrackKeyboardHeight } from './hooks/useTrackKeyboardHeight'
import {
  store$,
  ephemeral$,
  saveActiveFlowSession,
  getActiveFlowContent,
  flushEditorContent,
  hidePersistentEditor,
  updatePersistentEditorHeaderHeight,
  updatePersistentEditorBottomBarHeight,
  setFocusMode,
  hasReachedAutosaveCheckpoint,
} from 'app/state/store'
import { use$ } from '@legendapp/state/react'

export function JournalScreen() {
  const router = useRouter()
  const navigateHome = useNavigateHome()
  const [showExitConfirmDialog, setShowExitConfirmDialog] = useState(false)
  const activeFlow = use$(store$.activeFlow)
  useTrackKeyboardHeight()

  // Focus mode — read with ?? false (acceptable at consumer site per story design notes)
  const focusMode = use$(store$.profile?.editor?.focusMode) ?? false
  // Focus granularity — read with ?? 'paragraph' (UI-only preference)
  const focusGranularity = use$(store$.profile?.editor?.focusGranularity) ?? 'paragraph'

  const handleBackToHome = () => {
    hidePersistentEditor()
    navigateHome()
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
    // Checkpoint any still-debounced typing before we read content — otherwise
    // a fast typist's last burst is missing from the store and the empty-content
    // branch below would discard it straight to home.
    flushEditorContent()
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
            <Editor
              focusMode={focusMode}
              focusGranularity={focusGranularity}
            />
          </YStack>
        )}
      </AnimatePresence>

      {/* Bottom bar — word count + finish button */}
      <KeyboardOffsetView>
        <FlowSessionBottomBar
          visible={hasContent}
          wordCount={wordCount}
          focusMode={focusMode}
          onToggleFocusMode={() => setFocusMode(!focusMode)}
          onFinish={handleExitFlow}
          onLayout={handleBottomBarLayout}
        />
      </KeyboardOffsetView>

      {/* Exit-confirm dialog — shown when tapping Finish Session with <50 words and no checkpoint */}
      <FlowExitConfirmDialog
        open={showExitConfirmDialog}
        onOpenChange={setShowExitConfirmDialog}
        onCancel={() => setShowExitConfirmDialog(false)}
        onConfirm={handleConfirmExit}
      />
    </YStack>
  )
}
