import { useCallback } from 'react'
import { AnimatePresence, ScrollView, Text, View, XStack, YStack } from '@my/ui'
import { use$ } from '@legendapp/state/react'
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
import type { EncryptionMode } from 'app/types/index'

const MODE_CARDS = {
  e2e: {
    title: 'Strict Privacy Mode (E2E)',
    bullets: [
      'You hold the only key to unlock your journal.',
      'Total privacy from everyone, including us.',
      'Unrecoverable if you ever forget your password.',
    ],
  },
  managed: {
    title: 'Cloud Backup Mode',
    bullets: [
      'We securely handle the encryption behind the scenes.',
      'Simple password recovery if you ever get locked out.',
      'We can assist you if needed.',
    ],
  },
} as const

function ModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: EncryptionMode
  selected: boolean
  onSelect: (mode: EncryptionMode) => void
}) {
  const card = MODE_CARDS[mode]

  return (
    <YStack
      testID={`privacy-tier-${mode}`}
      padding="$5"
      width="100%"
      borderWidth={1}
      borderColor={selected ? '$color8' : '$color3'}
      backgroundColor={selected ? '$color1' : 'transparent'}
      cursor="pointer"
      hoverStyle={{ borderColor: '$color6' }}
      onPress={() => onSelect(mode)}
      gap="$3"
    >
      <Text fontFamily="$journal" fontSize={20} color="$color">
        {card.title}
      </Text>
      <YStack gap="$2" paddingLeft="$1">
        {card.bullets.map((bullet) => (
          <XStack key={bullet} gap="$2" alignItems="flex-start">
            <Text fontFamily="$body" fontSize={14} color="$color8">
              {'\u2022'}
            </Text>
            <Text fontFamily="$body" fontSize={14} color="$color8" flexShrink={1}>
              {bullet}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

/**
 * EncryptionModeDialog — full-page Cloud Sync setup flow.
 * Replaces the old AlertDialog modal with a full-screen overlay matching the design.
 */
export function EncryptionModeDialog() {
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

  const isLegacyE2EUnlock = step === 'legacy-e2e-password'
  const isUnlockingExistingE2E = isModeLocked && !!currentModeSalt
  const isSinglePasswordUnlock = isLegacyE2EUnlock || isUnlockingExistingE2E
  const isTrustBrowserStep = step === 'trust-browser'

  return (
    <AnimatePresence>
    {isOpen && (
    <View
      key="encryption-dialog"
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor="$background"
      zIndex={100}
      transition="quick"
      enterStyle={{ opacity: 0 }}
      exitStyle={{ opacity: 0 }}
      opacity={1}
    >
      <ScrollView
        flex={1}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack
          flex={1}
          width="100%"
          maxWidth={860}
          alignSelf="center"
          paddingHorizontal="$5"
          paddingTop="$5"
          paddingBottom={96}
          $sm={{ paddingHorizontal: '$8' }}
          $md={{ paddingHorizontal: '$10', paddingTop: '$8' }}
          $lg={{ paddingHorizontal: '$12', paddingTop: '$12' }}
          transition="designEnter"
          enterStyle={{ opacity: 0 }}
          opacity={1}
        >
          {/* Cancel button — top right */}
          <XStack justifyContent="flex-end" marginBottom={64}>
            <Text
              fontFamily="$body"
              fontSize={11}
              letterSpacing={2}
              textTransform="uppercase"
              color="$color8"
              cursor="pointer"
              hoverStyle={{ color: '$color' }}
              onPress={cancelEncryptionSetup}
            >
              Cancel
            </Text>
          </XStack>

          <View flex={1} position="relative">
          <AnimatePresence>
            {/* Step: Mode selection */}
            {!isTrustBrowserStep && step === 'choice' && (
              <YStack
                key="step-mode"
                transition="quick"
                enterStyle={{ opacity: 0, y: 10 }}
                exitStyle={{ opacity: 0, y: -10 }}
                opacity={1}
                y={0}
                gap={48}
                position="absolute"
                top={0}
                left={0}
                right={0}
              >
                <YStack gap="$3">
                  <Text
                    fontFamily="$journal"
                    fontSize={30}
                    color="$color"
                    letterSpacing={-0.5}
                  >
                    Cloud Sync Setup
                  </Text>
                  <Text fontFamily="$body" fontSize={14} color="$color8" lineHeight={22}>
                    Choose how your data is protected. This choice cannot be changed later.
                  </Text>
                </YStack>

                <YStack gap="$4">
                  <ModeCard
                    mode="e2e"
                    selected={selectedMode === 'e2e'}
                    onSelect={setSelectedEncryptionMode}
                  />
                  <ModeCard
                    mode="managed"
                    selected={selectedMode === 'managed'}
                    onSelect={setSelectedEncryptionMode}
                  />
                </YStack>

                {error && (
                  <Text fontFamily="$body" fontSize={13} color="$red10">
                    {error.message}
                  </Text>
                )}

                <YStack paddingTop="$4">
                  <Text
                    testID="confirm-encryption-mode"
                    fontFamily="$body"
                    fontSize={11}
                    letterSpacing={2}
                    textTransform="uppercase"
                    color={selectedMode ? '$color' : '$color8'}
                    opacity={selectedMode ? 1 : 0.5}
                    cursor={selectedMode ? 'pointer' : 'default'}
                    hoverStyle={selectedMode ? { opacity: 0.7 } : {}}
                    onPress={selectedMode ? () => void confirmEncryptionModeSelection() : undefined}
                  >
                    Continue
                  </Text>
                </YStack>
              </YStack>
            )}

            {/* Step: Password entry */}
            {!isTrustBrowserStep && step !== 'choice' && (
              <YStack
                key="step-password"
                transition="quick"
                enterStyle={{ opacity: 0, y: 10 }}
                exitStyle={{ opacity: 0, y: -10 }}
                opacity={1}
                y={0}
                position="absolute"
                top={0}
                left={0}
                right={0}
              >
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
                        : 'Secure Journal'
                  }
                  title={
                    isSinglePasswordUnlock
                      ? 'Unlock Encryption'
                      : 'Create Encryption Key'
                  }
                  description={
                    isSinglePasswordUnlock
                      ? 'Enter the encryption password you chose for this account to unlock Cloud Sync on this device.'
                      : 'Create a minimum 8-character password.'
                  }
                  descriptionWarning={
                    isSinglePasswordUnlock
                      ? undefined
                      : 'If you forget this, your cloud data is permanently lost.'
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

            {/* Step: Trust browser */}
            {isTrustBrowserStep && (
              <YStack
                key="step-trust"
                transition="quick"
                enterStyle={{ opacity: 0, y: 10 }}
                exitStyle={{ opacity: 0, y: -10 }}
                opacity={1}
                y={0}
                gap={48}
                alignItems="center"
                justifyContent="center"
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
              >
                <YStack gap="$3" maxWidth={448} alignItems="center">
                  <Text
                    fontFamily="$journal"
                    fontSize={30}
                    color="$color"
                    letterSpacing={-0.5}
                    textAlign="center"
                  >
                    Trust this Browser?
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    color="$color8"
                    lineHeight={22}
                    textAlign="center"
                  >
                    We can securely save your key in this browser. You won't need to re-enter your password every time you open the app here.
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={11}
                    color="$color7"
                    textAlign="center"
                  >
                    If browser data is cleared, you'll need your password again. You can revoke trust in Settings.
                  </Text>
                </YStack>

                {trustError && (
                  <YStack gap="$3" alignItems="center">
                    <Text fontFamily="$body" fontSize={13} color="$red10">
                      {trustError.message}
                    </Text>
                    <XStack gap="$6">
                      <Text
                        testID="trust-browser-dismiss"
                        fontFamily="$body"
                        fontSize={11}
                        letterSpacing={2}
                        textTransform="uppercase"
                        color="$color8"
                        cursor="pointer"
                        hoverStyle={{ color: '$color' }}
                        onPress={dismissTrustBrowserPrompt}
                      >
                        Dismiss
                      </Text>
                      <Text
                        testID="trust-browser-retry"
                        fontFamily="$body"
                        fontSize={11}
                        letterSpacing={2}
                        textTransform="uppercase"
                        color="$color"
                        cursor="pointer"
                        hoverStyle={{ opacity: 0.7 }}
                        onPress={handleAcceptTrust}
                      >
                        Retry
                      </Text>
                    </XStack>
                  </YStack>
                )}

                {!trustError && (
                  <XStack gap="$6" paddingTop="$4" opacity={isTrusting ? 0.4 : 1}>
                    <Text
                      testID="trust-browser-decline"
                      fontFamily="$body"
                      fontSize={11}
                      letterSpacing={2}
                      textTransform="uppercase"
                      color="$color8"
                      cursor={isTrusting ? 'default' : 'pointer'}
                      hoverStyle={isTrusting ? {} : { color: '$color' }}
                      onPress={isTrusting ? undefined : declineBrowserTrust}
                    >
                      Skip
                    </Text>
                    <Text
                      testID="trust-browser-accept"
                      fontFamily="$body"
                      fontSize={11}
                      letterSpacing={2}
                      textTransform="uppercase"
                      color="$color"
                      borderBottomWidth={1}
                      borderColor="$color5"
                      paddingBottom={2}
                      cursor={isTrusting ? 'default' : 'pointer'}
                      hoverStyle={isTrusting ? {} : { opacity: 0.7 }}
                      onPress={isTrusting ? undefined : handleAcceptTrust}
                    >
                      Trust Browser
                    </Text>
                  </XStack>
                )}
              </YStack>
            )}
          </AnimatePresence>
          </View>
        </YStack>
      </ScrollView>
    </View>
    )}
    </AnimatePresence>
  )
}
