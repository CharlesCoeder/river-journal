import { AlertDialog, Button, ScrollView, Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import {
  cancelEncryptionSetup,
  confirmEncryptionModeSelection,
  encryptionSetup$,
  retryWithE2EPassword,
  returnToEncryptionChoice,
  setSelectedEncryptionMode,
  submitE2EPassword,
} from 'app/state/encryptionSetup'
import { E2EPasswordForm } from './E2EPasswordForm'
import { PrivacyTierExplainer } from './PrivacyTierExplainer'

export function EncryptionModeDialog() {
  const router = useRouter()
  const isOpen = use$(encryptionSetup$.isOpen)
  const selectedMode = use$(encryptionSetup$.selectedMode)
  const step = use$(encryptionSetup$.step)
  const error = use$(encryptionSetup$.error)
  const currentModeSalt = use$(encryptionSetup$.currentModeSalt)
  const isModeLocked = use$(encryptionSetup$.isModeLocked)

  if (!isOpen) return null

  const isLegacyE2EUnlock = step === 'legacy-e2e-password'
  const isUnlockingExistingE2E = isModeLocked && !!currentModeSalt
  const isSinglePasswordUnlock = isLegacyE2EUnlock || isUnlockingExistingE2E

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
                {isLegacyE2EUnlock
                  ? 'Unlock legacy E2E flows'
                  : step === 'e2e-password'
                    ? 'Finish end-to-end setup'
                    : step === 'saving'
                      ? selectedMode === 'e2e'
                        ? 'Finish end-to-end setup'
                        : 'Setting up managed encryption'
                      : 'Choose your encryption mode'}
              </AlertDialog.Title>

              <AlertDialog.Description fontFamily="$body" fontSize="$4" color="$color">
                {isLegacyE2EUnlock
                  ? 'Enter your old E2E password so this device can read historical encrypted flows.'
                  : step === 'e2e-password'
                    ? 'This password is separate from your account password and cannot be recovered for you.'
                    : 'Choose how Cloud Sync protects your journal before anything is uploaded.'}
              </AlertDialog.Description>
            </YStack>

            {step === 'choice' ? (
              <>
                <ScrollView maxHeight="$20" bounces={false}>
                  <YStack gap="$4" paddingRight="$1">
                    <PrivacyTierExplainer
                      selectedMode={selectedMode}
                      onModeSelect={setSelectedEncryptionMode}
                      privacyCenterLink={() => router.push('/privacy')}
                    />

                    <YStack gap="$2">
                      <Text fontSize="$3" fontFamily="$body" color="$orange10" fontWeight="700">
                        This choice cannot be changed later.
                      </Text>
                      {selectedMode === 'e2e' && (
                        <Text fontSize="$3" fontFamily="$body" color="$red10" fontWeight="700">
                          If you forget this password, your cloud data is unrecoverable.
                        </Text>
                      )}
                    </YStack>

                    {error && (
                      <Text fontSize="$3" fontFamily="$body" color="$red10">
                        {error.message}
                      </Text>
                    )}
                  </YStack>
                </ScrollView>

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
                      ? 'Confirm Strict Privacy Mode'
                      : 'Confirm Cloud Backup Mode'}
                  </Button>
                </XStack>
              </>
            ) : (
              <E2EPasswordForm
                errorMessage={error?.message}
                isSaving={step === 'saving'}
                onBack={isLegacyE2EUnlock ? cancelEncryptionSetup : returnToEncryptionChoice}
                onCancel={cancelEncryptionSetup}
                showBackButton={!isModeLocked && !isLegacyE2EUnlock}
                requireConfirmation={!isSinglePasswordUnlock}
                submitLabel={
                  isLegacyE2EUnlock
                    ? 'Unlock legacy E2E flows'
                    : isSinglePasswordUnlock
                      ? 'Unlock encryption'
                      : 'Save and continue'
                }
                title={
                  isSinglePasswordUnlock ? 'Enter your encryption password' : 'Create an encryption password'
                }
                description={
                  isSinglePasswordUnlock
                    ? 'Use the encryption password you already chose for this account so this device can unlock Cloud Sync.'
                    : 'This password is separate from your account password and cannot be recovered for you.'
                }
                onSubmit={(password, confirmPassword) => {
                  if (isLegacyE2EUnlock) {
                    void retryWithE2EPassword(password)
                  } else {
                    void submitE2EPassword(password, confirmPassword)
                  }
                }}
              />
            )}
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
