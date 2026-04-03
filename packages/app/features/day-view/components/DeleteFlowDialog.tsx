import { AlertDialog, Button, Text, XStack } from '@my/ui'
import type { Flow } from 'app/state/types'

interface DeleteFlowDialogProps {
  flow: Flow | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Extracts first ~50 words for confirmation dialog preview
 */
function getFlowPreview(content: string, wordLimit = 50): string {
  const words = content.trim().split(/\s+/)
  if (words.length <= wordLimit) return content
  return words.slice(0, wordLimit).join(' ') + '...'
}

export function DeleteFlowDialog({ flow, onConfirm, onCancel }: DeleteFlowDialogProps) {
  return (
    <AlertDialog open={!!flow} onOpenChange={onCancel}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          key="overlay"
          transition="quick"
          opacity={0.4}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <AlertDialog.Content
          key="content"
          transition={['medium', { opacity: { overshootClamping: true } }]}
          enterStyle={{ y: -10, opacity: 0 }}
          exitStyle={{ y: 10, opacity: 0 }}
          y={0}
          opacity={1}
          backgroundColor="$background"
          borderRadius="$6"
          borderWidth={1}
          borderColor="$color5"
          padding="$5"
          gap="$4"
          maxWidth={400}
        >
          <AlertDialog.Title fontFamily="$body" fontWeight="700">
            Delete Flow?
          </AlertDialog.Title>
          <AlertDialog.Description fontFamily="$body" color="$color10">
            {flow && getFlowPreview(flow.content)}
          </AlertDialog.Description>
          <XStack gap="$3" justifyContent="flex-end">
            <AlertDialog.Cancel asChild>
              <Button chromeless borderWidth={1} borderColor="$borderColor">
                <Text fontFamily="$body">Cancel</Text>
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                backgroundColor="$red10"
                color="white"
                onPress={onConfirm}
                hoverStyle={{ backgroundColor: '$red11' }}
                pressStyle={{ backgroundColor: '$red11' }}
              >
                <Text fontFamily="$body" fontWeight="600" color="white">
                  Delete
                </Text>
              </Button>
            </AlertDialog.Action>
          </XStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
