import { useCallback, useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@my/ui'

interface E2EPasswordFormProps {
  errorMessage?: string
  isSaving: boolean
  onBack: () => void
  onCancel: () => void
  onSubmit: (password: string, confirmPassword: string) => void
  submitLabel?: string
  title?: string
  description?: string
  showBackButton?: boolean
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
  showBackButton = true,
}: E2EPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handleSubmit = useCallback(() => {
    onSubmit(password, confirmPassword)
  }, [confirmPassword, onSubmit, password])

  return (
    <YStack gap="$3">
      <YStack gap="$1.5">
        <Text fontSize="$5" fontFamily="$body" fontWeight="700">
          {title}
        </Text>
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          {description}
        </Text>
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          Encryption password
        </Text>
        <Input
          testID="e2e-password-input"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          placeholder="At least 8 characters"
          disabled={isSaving}
        />
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          Confirm encryption password
        </Text>
        <Input
          testID="e2e-confirm-password-input"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          placeholder="Re-enter your password"
          disabled={isSaving}
        />
      </YStack>

      <Text fontSize="$2" fontFamily="$body" color="$color10">
        If you forget this password, your cloud data is unrecoverable.
      </Text>

      {errorMessage && (
        <Text fontSize="$3" fontFamily="$body" color="$red10">
          {errorMessage}
        </Text>
      )}

      <XStack gap="$3" justifyContent="flex-end">
        <Button
          testID="e2e-password-cancel"
          variant="outlined"
          onPress={onCancel}
          disabled={isSaving}
          fontFamily="$body"
        >
          Cancel
        </Button>
        {showBackButton && (
          <Button
            testID="e2e-password-back"
            variant="outlined"
            onPress={onBack}
            disabled={isSaving}
            fontFamily="$body"
          >
            Back
          </Button>
        )}
        <Button
          testID="e2e-password-submit"
          onPress={handleSubmit}
          disabled={isSaving}
          fontFamily="$body"
        >
          {isSaving ? 'Saving…' : submitLabel}
        </Button>
      </XStack>
    </YStack>
  )
}
