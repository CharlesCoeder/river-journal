import { useEffect, useState } from 'react'
import { YStack, H4, Theme, WordCountDisplay } from '@my/ui'
import { observer, use$ } from '@legendapp/state/react'
import {
  journal$,
  updateCurrentFlowContent,
  saveCurrentFlowSession,
  waitForJournalLoaded,
} from '../../state/journal'
import { theme$, setTheme } from '../../state/theme'
import { JournalingContainer } from './components/JournalingContainer'
import { JournalingControls } from './components/JournalingControls'
import { JournalingEditor } from './components/JournalingEditor'

export const JournalingScreen = observer(function JournalingScreen() {
  const [isLoaded, setIsLoaded] = useState(false)

  const currentContent = use$(journal$.currentFlowContent)
  const wordCount = use$(journal$.currentFlowWordCount)
  const currentTheme = use$(theme$.currentTheme)

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
      <Theme name={currentTheme}>
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
    <Theme name={currentTheme}>
      <JournalingContainer>
        {/* Header area with essential controls */}
        <JournalingControls onExitFlow={handleExitFlow} />
        
        {/* Word count display area */}
        <WordCountDisplay 
          currentCount={wordCount} 
          dailyTarget={dailyTarget} 
        />
        
        {/* Main writing area - center-aligned and focused */}
        <JournalingEditor
          content={currentContent}
          onContentChange={updateCurrentFlowContent}
          placeholder="Begin your stream-of-consciousness writing here..."
        />
      </JournalingContainer>
    </Theme>
  )
})
