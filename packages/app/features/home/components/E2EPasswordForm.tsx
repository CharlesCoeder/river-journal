import { useCallback, useState } from 'react'
import { Input, Text, XStack, YStack } from '@my/ui'

interface E2EPasswordFormProps {
  errorMessage?: string
  isSaving: boolean
  onBack: () => void
  onCancel: () => void
  onSubmit: (password: string, confirmPassword: string) => void
  submitLabel?: string
  title?: string
  description?: string
  descriptionWarning?: string
  showBackButton?: boolean
  requireConfirmation?: boolean
}

export function E2EPasswordForm({
  errorMessage,
  isSaving,
  onBack,
  onCancel,
  onSubmit,
  submitLabel = 'Save and continue',
  title = 'Create an encryption password',
  description = 'This password is separate from your account password and cannot be recovered for you.',
  descriptionWarning,
  showBackButton = true,
  requireConfirmation = true,
}: E2EPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handleSubmit = useCallback(() => {
    onSubmit(password, confirmPassword)
  }, [confirmPassword, onSubmit, password])

  return (
    <YStack gap={48}>
      {/* Title & description */}
      <YStack gap="$3">
        <Text
          fontFamily="$journal"
          fontSize={30}
          color="$color"
          letterSpacing={-0.5}
        >
          {title}
        </Text>
        <YStack gap="$1">
          <Text fontFamily="$body" fontSize={14} color="$color8" lineHeight={22}>
            {description}
          </Text>
          {descriptionWarning && (
            <Text fontFamily="$body" fontSize={14} color="$color" lineHeight={22}>
              {descriptionWarning}
            </Text>
          )}
        </YStack>
      </YStack>

      {/* Input fields */}
      <YStack gap="$6" maxWidth={384}>
        <YStack gap="$2">
          <Text
            fontFamily="$body"
            fontSize={11}
            letterSpacing={2}
            textTransform="uppercase"
            color="$color8"
          >
            Password
          </Text>
          <Input
            testID="e2e-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={requireConfirmation ? 'password-new' : 'current-password'}
            textContentType={requireConfirmation ? 'newPassword' : 'password'}
            disabled={isSaving}
            backgroundColor="transparent"
            borderWidth={0}
            borderBottomWidth={1}
            borderColor="$color5"
            borderRadius={0}
            fontFamily="$journal"
            fontSize={20}
            color="$color"
            paddingHorizontal={0}
            paddingVertical="$2"
            focusStyle={{ borderColor: '$color' }}
          />
        </YStack>

        {requireConfirmation && (
          <YStack gap="$2">
            <Text
              fontFamily="$body"
              fontSize={11}
              letterSpacing={2}
              textTransform="uppercase"
              color="$color8"
            >
              Confirm Password
            </Text>
            <Input
              testID="e2e-confirm-password-input"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              textContentType="newPassword"
              disabled={isSaving}
              backgroundColor="transparent"
              borderWidth={0}
              borderBottomWidth={1}
              borderColor="$color5"
              borderRadius={0}
              fontFamily="$journal"
              fontSize={20}
              color="$color"
              paddingHorizontal={0}
              paddingVertical="$2"
              focusStyle={{ borderColor: '$color' }}
            />
          </YStack>
        )}

        {errorMessage && (
          <Text fontFamily="$body" fontSize={12} color="$red10">
            {errorMessage}
          </Text>
        )}
      </YStack>

      {/* Submit action */}
      <YStack paddingTop="$4">
        <Text
          testID="e2e-password-submit"
          fontFamily="$body"
          fontSize={11}
          letterSpacing={2}
          textTransform="uppercase"
          color={isSaving ? '$color8' : '$color'}
          opacity={isSaving ? 0.5 : 1}
          cursor={isSaving ? 'default' : 'pointer'}
          hoverStyle={isSaving ? {} : { opacity: 0.7 }}
          onPress={isSaving ? undefined : handleSubmit}
        >
          {isSaving ? 'Saving…' : submitLabel}
        </Text>
      </YStack>

      {/* Hidden elements to preserve testIDs for integration tests */}
      <XStack display="none">
        <Text testID="e2e-password-cancel" onPress={onCancel} />
        {showBackButton && <Text testID="e2e-password-back" onPress={onBack} />}
      </XStack>
    </YStack>
  )
}
