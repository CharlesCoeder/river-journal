import { Text, YStack, Button, XStack } from 'tamagui'
import { useState } from 'react'

export interface HelloComponentProps {
  testId?: string
}

export function HelloComponent({ testId = 'hello-component' }: HelloComponentProps = {}) {
  const [testResult, setTestResult] = useState<string>('')

  const handleTestPersistence = async () => {
    try {
      // Dynamic import to avoid SSR issues
      const { journal$, waitForJournalLoaded } = await import('app/state/journal/store')

      // Wait for persistence to load
      await waitForJournalLoaded()

      // Check if data exists from previous sessions
      const currentEntry = journal$.currentEntry.get()
      const allEntries = journal$.entries.get()
      const lastUpdated = journal$.lastUpdated.get()

      if (allEntries.length > 0 || currentEntry) {
        const totalFlows = allEntries.reduce((total, entry) => total + entry.flows.length, 0)
        const totalWords = allEntries.reduce((total, entry) => total + entry.finalWordCount, 0)

        setTestResult(
          `✅ Persistence working! Found ${allEntries.length} journal entry(ies), ${totalFlows} flow(s), ${totalWords} total words.${lastUpdated ? ` Last updated: ${new Date(lastUpdated).toLocaleTimeString()}` : ''}`
        )
      } else {
        setTestResult(
          '📝 No persisted data found yet. Try the demo page to create some data first!'
        )
      }
    } catch (error) {
      setTestResult(`❌ Persistence test error: ${error.message}`)
      console.error('Persistence test error:', error)
    }
  }

  const handleCreateTestData = async () => {
    try {
      const { testBasicPersistence } = await import('app/state/journal/store')
      testBasicPersistence()
      setTestResult(
        '✅ Test data created! Refresh the page and click "Check Persistence" to verify it persisted.'
      )
    } catch (error) {
      setTestResult(`❌ Error creating test data: ${error.message}`)
    }
  }

  return (
    <YStack padding="$4" alignItems="center" testID={testId} gap="$3">
      <Text fontSize="$6" fontWeight="bold" color="$color">
        Hello River Journal
      </Text>

      <XStack gap="$2" alignItems="center">
        <Button size="$3" onPress={handleTestPersistence}>
          Check Persistence
        </Button>
        <Button size="$3" variant="outlined" onPress={handleCreateTestData}>
          Create Test Data
        </Button>
      </XStack>

      {testResult ? (
        <Text fontSize="$3" textAlign="center" maxWidth={400}>
          {testResult}
        </Text>
      ) : null}
    </YStack>
  )
}
