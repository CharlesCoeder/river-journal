import { useCallback } from 'react'
import { AlertDialog, AnimatePresence, Button, ScrollView, Separator, Text, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { useRouter } from 'solito/navigation'
import {
  acceptBrowserTrust,
  cancelEncryptionSetup,
  confirmEncryptionModeSelection,
  declineBrowserTrust,
  dismissTrustBrowserPrompt,
  encryptionSetup$,
  retryWithE2EPassword,
  returnToEncryptionChoice,
  setSelectedEncryptionMode,
  submitE2EPassword,
  trustBrowserPrompt$,
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

  const isTrusting = use$(trustBrowserPrompt$.isTrusting)
  const trustError = use$(trustBrowserPrompt$.trustError)

  const handleAcceptTrust = useCallback(() => {
    void acceptBrowserTrust()
  }, [])

  if (!isOpen) return null

  const isLegacyE2EUnlock = step === 'legacy-e2e-password'
  const isUnlockingExistingE2E = isModeLocked && !!currentModeSalt
  const isSinglePasswordUnlock = isLegacyE2EUnlock || isUnlockingExistingE2E
  const isTrustBrowserStep = step === 'trust-browser'

  const getTitle = () => {
    if (isTrustBrowserStep) return 'Trust this browser?'
    if (isLegacyE2EUnlock) return 'Unlock legacy E2E flows'
    if (step === 'e2e-password' || step === 'saving') {
      if (isSinglePasswordUnlock) return 'Unlock encryption'
      if (selectedMode === 'e2e') return 'Set up end-to-end encryption'
      return 'Setting up managed encryption'
    }
    return 'Choose your encryption mode'
  }

  const getDescription = () => {
    if (isTrustBrowserStep) return 'Save your encryption key in this browser so you won\'t need to enter your password next time.'
    if (isLegacyE2EUnlock) return 'Enter your old E2E password so this device can read historical encrypted flows.'
    if (step === 'e2e-password' || step === 'saving') {
      if (isSinglePasswordUnlock) return 'Enter the encryption password you chose for this account to unlock Cloud Sync on this device.'
      return 'This password is separate from your account password and cannot be recovered for you.'
    }
    return 'Choose how Cloud Sync protects your journal before anything is uploaded.'
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={() => {}}>
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
          transition="designModal"
          enterStyle={{ opacity: 0, scale: 0.98 }}
          exitStyle={{ opacity: 0, scale: 0.98 }}
          scale={1}
          opacity={1}
          backgroundColor="$background"
          borderRadius="$6"
          borderWidth={1}
          borderColor="$color5"
          padding="$5"
          maxWidth={520}
          width="92%"
        >
          <YStack gap="$4">
            <YStack gap="$1.5">
              <AlertDialog.Title fontFamily="$body" fontSize="$6" fontWeight="700">
                {getTitle()}
              </AlertDialog.Title>

              <AlertDialog.Description fontFamily="$body" fontSize="$4" color="$color">
                {getDescription()}
              </AlertDialog.Description>
            </YStack>

            <AnimatePresence>
              {isTrustBrowserStep && (
                <YStack key="step-trust" transition="quick" enterStyle={{ opacity: 0, y: 10 }} exitStyle={{ opacity: 0, y: -10 }} opacity={1} y={0} gap="$3">
                  <Text fontSize="$3" fontFamily="$body" color="$color11">
                    Your encryption key will be stored securely in this browser.
                    You can revoke trust at any time from your settings.
                  </Text>
                  <Text fontSize="$2" fontFamily="$body" color="$color10">
                    If your browser data is cleared — either by you or by the browser
                    itself under storage pressure — you'll need to re-enter your password.
                  </Text>

                  <Separator />

                  {isTrusting && (
                    <Text fontSize="$3" fontFamily="$body" color="$color11">
                      Securing your key…
                    </Text>
                  )}

                  {trustError && (
                    <YStack gap="$2">
                      <Text fontSize="$3" fontFamily="$body" color="$red10">
                        {trustError.message}
                      </Text>
                      <XStack gap="$3" justifyContent="flex-end">
                        <Button
                          testID="trust-browser-dismiss"
                          variant="outlined"
                          onPress={dismissTrustBrowserPrompt}
                          fontFamily="$body"
                        >
                          Dismiss
                        </Button>
                        <Button
                          testID="trust-browser-retry"
                          onPress={handleAcceptTrust}
                          fontFamily="$body"
                        >
                          Retry
                        </Button>
                      </XStack>
                    </YStack>
                  )}

                  {!isTrusting && !trustError && (
                    <XStack gap="$3" justifyContent="flex-end">
                      <Button
                        testID="trust-browser-decline"
                        variant="outlined"
                        onPress={declineBrowserTrust}
                        fontFamily="$body"
                      >
                        Not now
                      </Button>
                      <Button
                        testID="trust-browser-accept"
                        onPress={handleAcceptTrust}
                        fontFamily="$body"
                      >
                        Trust this browser
                      </Button>
                    </XStack>
                  )}
                </YStack>
              )}

              {!isTrustBrowserStep && step === 'choice' && (
                <YStack key="step-choice" transition="quick" enterStyle={{ opacity: 0, y: 10 }} exitStyle={{ opacity: 0, y: -10 }} opacity={1} y={0} gap="$4">
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
                </YStack>
              )}

              {!isTrustBrowserStep && step !== 'choice' && (
                <YStack key="step-password" transition="quick" enterStyle={{ opacity: 0, y: 10 }} exitStyle={{ opacity: 0, y: -10 }} opacity={1} y={0}>
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
                </YStack>
              )}
            </AnimatePresence>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
