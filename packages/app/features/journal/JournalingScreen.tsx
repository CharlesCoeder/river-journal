import { useEffect, useState } from 'react'
import { YStack, XStack, H1, H4, Theme, WordCountDisplay, ThemeSwitcher } from '@my/ui'
import { observer, use$ } from '@legendapp/state/react'
import {
  journal$,
  updateCurrentFlowContent,
  saveCurrentFlowSession,
  waitForJournalLoaded,
} from '../../state/journal'
import { theme$ } from '../../state/theme'
import { JournalingContainer } from './components/JournalingContainer'
import { JournalingControls } from './components/JournalingControls'
import { JournalingEditor } from './components/JournalingEditor'

export const JournalingScreen = observer(function JournalingScreen() {
  const [isLoaded, setIsLoaded] = useState(false)

  const currentContent = use$(journal$.currentFlowContent)
  const wordCount = use$(journal$.currentFlowWordCount)
  const colorTheme = use$(theme$.colorTheme)

  const dailyTarget = 750 // Default daily target words

  // Wait for persistence to load, but don't auto-initialize flow session
  useEffect(() => {
    const loadPersistence = async () => {
      // Wait for journal state to be loaded from persistence
      await waitForJournalLoaded()
      setIsLoaded(true)
      // Don't auto-initialize - let first keystroke trigger flow creation
    }

    loadPersistence()
  }, [])

  // Show loading state while persistence is loading
  if (!isLoaded) {
    return (
      <Theme name={colorTheme}>
        <YStack flex={1} alignItems="center" justifyContent="center" backgroundColor="$background">
          <H4 color="$color">Loading...</H4>
        </YStack>
      </Theme>
    )
  }

  const handleExitFlow = () => {
    saveCurrentFlowSession()
    // TODO: Implement actual exit flow logic
  }

  return (
    <Theme name={colorTheme}>
      <JournalingContainer>
        {/* Top row with word count */}
        <XStack justifyContent="flex-end" alignItems="center" paddingBottom="$2">
          <WordCountDisplay currentCount={wordCount} dailyTarget={dailyTarget} />
        </XStack>

        {/* App title and theme switcher */}
        <XStack justifyContent="center" alignItems="center" paddingBottom="$3">
          <YStack gap="$4">
            <H1>River Journal</H1>
            <ThemeSwitcher />
          </YStack>
        </XStack>

        {/* Centered controls */}
        <JournalingControls onExitFlow={handleExitFlow} />

        {/* Main writing area */}
        <JournalingEditor
          content={currentContent}
          onContentChange={updateCurrentFlowContent}
          placeholder="Begin your stream-of-consciousness writing here..."
        />
      </JournalingContainer>
    </Theme>
  )
})
