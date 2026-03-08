import { AlertDialog, Button, Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import {
  cancelEncryptionSetup,
  confirmEncryptionModeSelection,
  encryptionSetup$,
  returnToEncryptionChoice,
  setSelectedEncryptionMode,
  submitE2EPassword,
} from 'app/state/encryptionSetup'
import type { EncryptionMode } from 'app/types/index'
import { E2EPasswordForm } from './E2EPasswordForm'

const MODE_COPY: Record<
  EncryptionMode,
  {
    title: string
    body: string
  }
> = {
  e2e: {
    title: 'E2E Encryption',
    body: 'Set an encryption password. We can never see your data.',
  },
  managed: {
    title: 'Managed Encryption',
    body: 'We manage encryption. Standard password recovery available.',
  },
}

function ModeOption({
  mode,
  selected,
  onSelect,
}: {
  mode: EncryptionMode
  selected: boolean
  onSelect: (mode: EncryptionMode) => void
}) {
  const copy = MODE_COPY[mode]

  return (
    <Button
      testID={`encryption-mode-${mode}`}
      size="$5"
      variant={selected ? undefined : 'outlined'}
      justifyContent="flex-start"
      alignItems="flex-start"
      onPress={() => onSelect(mode)}
      fontFamily="$body"
    >
      <YStack alignItems="flex-start" gap="$1">
        <Text fontSize="$4" fontFamily="$body" fontWeight="700">
          {copy.title}
        </Text>
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          {copy.body}
        </Text>
      </YStack>
    </Button>
  )
}

export function EncryptionModeDialog() {
  const isOpen = use$(encryptionSetup$.isOpen)
  const selectedMode = use$(encryptionSetup$.selectedMode)
  const step = use$(encryptionSetup$.step)
  const error = use$(encryptionSetup$.error)

  if (!isOpen) return null

  return (
    <AlertDialog open={isOpen} onOpenChange={() => {}}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          key="overlay"
          animation="quick"
          opacity={0.5}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <AlertDialog.Content
          key="content"
          bordered
          elevate
          animation={['quick', { opacity: { overshootClamping: true } }]}
          enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.96 }}
          exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.96 }}
          x={0}
          scale={1}
          opacity={1}
          y={0}
          backgroundColor="$background"
          maxWidth={520}
          width="92%"
        >
          <YStack gap="$4">
            <YStack gap="$1.5">
              <AlertDialog.Title fontFamily="$body" fontSize="$6" fontWeight="700">
                {step === 'e2e-password' || step === 'saving'
                  ? 'Finish end-to-end setup'
                  : 'Choose your encryption mode'}
              </AlertDialog.Title>

              <AlertDialog.Description fontFamily="$body" fontSize="$4" color="$color">
                Choose how Cloud Sync protects your journal before anything is uploaded.
              </AlertDialog.Description>
            </YStack>

            {step === 'choice' ? (
              <>
                <YStack gap="$3">
                  <ModeOption
                    mode="e2e"
                    selected={selectedMode === 'e2e'}
                    onSelect={setSelectedEncryptionMode}
                  />
                  <ModeOption
                    mode="managed"
                    selected={selectedMode === 'managed'}
                    onSelect={setSelectedEncryptionMode}
                  />
                </YStack>

                <YStack gap="$2">
                  <Text fontSize="$3" fontFamily="$body" color="$orange10" fontWeight="700">
                    This choice cannot be changed later.
                  </Text>
                  <Text fontSize="$3" fontFamily="$body" color="$red10" fontWeight="700">
                    If you forget this password, your cloud data is unrecoverable.
                  </Text>
                  <Text fontSize="$2" fontFamily="$body" color="$color11">
                    Cloud content is still plaintext in the current sync pipeline until the follow-up
                    encryption bootstrap lands.
                  </Text>
                </YStack>

                {error && (
                  <Text fontSize="$3" fontFamily="$body" color="$red10">
                    {error.message}
                  </Text>
                )}

                <XStack gap="$3" justifyContent="flex-end">
                  <Button variant="outlined" onPress={cancelEncryptionSetup} fontFamily="$body">
                    Cancel
                  </Button>
                  <Button
                    testID="confirm-encryption-mode"
                    onPress={() => {
                      void confirmEncryptionModeSelection()
                    }}
                    fontFamily="$body"
                  >
                    {selectedMode === 'e2e'
                      ? 'Confirm End-to-End Encryption'
                      : 'Confirm Managed Encryption'}
                  </Button>
                </XStack>
              </>
            ) : (
              <E2EPasswordForm
                errorMessage={error?.message}
                isSaving={step === 'saving'}
                onBack={returnToEncryptionChoice}
                onSubmit={(password, confirmPassword) => {
                  void submitE2EPassword(password, confirmPassword)
                }}
              />
            )}
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
