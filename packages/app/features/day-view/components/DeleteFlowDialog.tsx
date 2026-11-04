import { AlertDialog, Button } from '@my/ui'
import { Text, View } from '@tamagui/tailwind'
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
          transition={{
            preset: 'medium',
            opacity: { preset: 'medium', spring: { overshootClamping: true } },
          }}
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
            fontSize={16}
            lineHeight="web:normal"
            color="color10"
          >
            {flow && getFlowPreview(flow.content)}
          </AlertDialog.Description>
          <View className="flex-row gap-3 justify-end">
            <AlertDialog.Cancel asChild>
              <Button
                variant="quiet"
                borderWidth={1}
                borderColor="border-color hover:transparent press:border-color-hover"
              >
                <Text className="font-body text-color">Cancel</Text>
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button onPress={onConfirm}>
                <Text className="font-body font-semibold text-[#ffffff]">Delete</Text>
              </Button>
            </AlertDialog.Action>
          </View>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
