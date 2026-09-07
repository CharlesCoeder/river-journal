import {
  AnimatePresence,
  XStack,
  Dialog,
  ExpandingLineButton,
  WordCounter,
  isWeb,
  useReducedMotion,
} from '@my/ui'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import type { LayoutChangeEvent } from 'react-native'

// ---------------------------------------------------------------------------
// Flow-session chrome shared by every surface that hosts the editor: the
// bottom bar (focus-mode toggle, live word count, Finish Session) and the
// "barely written" exit-confirm dialog. Pure presentation — the hosting
// screen owns the exit/save decision so JournalScreen and the inline home
// can wire different consequences to the same controls.
// ---------------------------------------------------------------------------

export interface FlowSessionBottomBarProps {
  /** The bar animates in once there is something to finish. */
  visible: boolean
  wordCount: number
  focusMode: boolean
  onToggleFocusMode: () => void
  onFinish: () => void
  /** Native: reports the bar's height so the persistent editor can inset above it. */
  onLayout?: (e: LayoutChangeEvent) => void
}

export function FlowSessionBottomBar({
  visible,
  wordCount,
  focusMode,
  onToggleFocusMode,
  onFinish,
  onLayout,
}: FlowSessionBottomBarProps) {
  return (
    <AnimatePresence>
      {visible && (
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
          onLayout={onLayout}
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
            <XStack
              alignItems="center"
              gap="$3"
            >
              <ExpandingLineButton
                size="default"
                onPress={onToggleFocusMode}
                aria-label="Toggle focus mode"
                aria-pressed={focusMode}
              >
                {focusMode ? <EyeOff size={16} /> : <Eye size={16} />}
              </ExpandingLineButton>
              <WordCounter count={wordCount} />
            </XStack>

            <ExpandingLineButton
              size="default"
              onPress={onFinish}
            >
              Finish Session
            </ExpandingLineButton>
          </XStack>
        </XStack>
      )}
    </AnimatePresence>
  )
}

export interface FlowExitConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

/** Shown when finishing with <50 words and no autosave checkpoint. */
export function FlowExitConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
}: FlowExitConfirmDialogProps) {
  const reduceMotion = useReducedMotion()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
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
              onPress={onCancel}
            >
              Cancel
            </ExpandingLineButton>
            <ExpandingLineButton
              size="default"
              onPress={onConfirm}
            >
              Confirm
            </ExpandingLineButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
