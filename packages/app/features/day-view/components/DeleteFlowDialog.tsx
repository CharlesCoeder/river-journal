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
    <AlertDialog
      open={!!flow}
      onOpenChange={onCancel}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          key="overlay"
          transition="quick"
          opacity="0.4 enter:0 exit:0"
        />
        <AlertDialog.Content
          key="content"
          transition={{ preset: 'medium', opacity: { preset: 'medium', spring: { overshootClamping: true } } }}
          y="0 enter:-10px exit:10px"
          opacity="1 enter:0 exit:0"
          backgroundColor="background"
          borderRadius="6"
          borderWidth={1}
          borderColor="color5"
          padding="5"
          gap="4"
          maxWidth={400}
        >
          <AlertDialog.Title
            fontFamily="body"
            fontWeight="700"
          >
            Delete Flow?
          </AlertDialog.Title>
          <AlertDialog.Description
            fontFamily="body"
            color="color10"
          >
            {flow && getFlowPreview(flow.content)}
          </AlertDialog.Description>
          <XStack
            gap="3"
            justifyContent="flex-end"
          >
            <AlertDialog.Cancel asChild>
              <Button
                chromeless
                borderWidth={1}
                borderColor="border-color"
              >
                <Text fontFamily="body">Cancel</Text>
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                backgroundColor="red10 hover:red11 press:red11"
                onPress={onConfirm}
              >
                <Text
                  fontFamily="body"
                  fontWeight="600"
                  color="white"
                >
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
