/**
 * AddPasswordForm — Sets or changes user password.
 * Mode is determined by the user_has_password() RPC:
 *   - 'add': OAuth-only user setting a password for the first time
 *   - 'change': User who already has a password updating it (requires current password)
 * Uses supabase.auth.updateUser({ password }) which works for both cases.
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Input, Button, Text, Spinner } from '@my/ui'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { updatePassword, signInWithEmail } from 'app/utils'

const MIN_PASSWORD_LENGTH = 8

interface AddPasswordFormProps {
  mode: 'add' | 'change'
  onSuccess: () => void
  onCancel: () => void
}

export function AddPasswordForm({ mode, onSuccess, onCancel }: AddPasswordFormProps) {
  const email = use$(store$.session.email)

  const [currentPassword, setCurrentPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{
    currentPassword?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})

  const title = mode === 'add' ? 'Add Password' : 'Change Password'

  const validateCurrentPassword = useCallback(
    (value: string): string | undefined => {
      if (mode !== 'change') return undefined
      if (!value) return 'Current password is required'
      return undefined
    },
    [mode]
  )

  const validatePassword = useCallback((value: string): string | undefined => {
    if (!value) return 'Password is required'
    if (value.length < MIN_PASSWORD_LENGTH)
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    return undefined
  }, [])

  const validateConfirmPassword = useCallback(
    (value: string): string | undefined => {
      if (!value) return 'Please confirm your password'
      if (value !== password) return 'Passwords do not match'
      return undefined
    },
    [password]
  )

  const handleCurrentPasswordBlur = useCallback(() => {
    setErrors((prev) => ({
      ...prev,
      currentPassword: validateCurrentPassword(currentPassword),
    }))
  }, [currentPassword, validateCurrentPassword])

  const handlePasswordBlur = useCallback(() => {
    setErrors((prev) => ({ ...prev, password: validatePassword(password) }))
  }, [password, validatePassword])

  const handleConfirmPasswordBlur = useCallback(() => {
    setErrors((prev) => ({
      ...prev,
      confirmPassword: validateConfirmPassword(confirmPassword),
    }))
  }, [confirmPassword, validateConfirmPassword])

  const handleCurrentPasswordChange = useCallback((value: string) => {
    setCurrentPassword(value)
    setErrors((prev) => ({ ...prev, currentPassword: undefined }))
  }, [])

  const handlePasswordChange = useCallback((value: string) => {
    setPassword(value)
    setErrors((prev) => ({ ...prev, password: undefined }))
  }, [])

  const handleConfirmPasswordChange = useCallback((value: string) => {
    setConfirmPassword(value)
    setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
  }, [])

  const handleSubmit = useCallback(async () => {
    setErrors({})

    const currentError = validateCurrentPassword(currentPassword)
    const passwordError = validatePassword(password)
    const confirmError = validateConfirmPassword(confirmPassword)

    if (currentError || passwordError || confirmError) {
      setErrors({
        currentPassword: currentError,
        password: passwordError,
        confirmPassword: confirmError,
      })
      return
    }

    setIsLoading(true)
    try {
      if (mode === 'change' && email) {
        const { error: verifyError } = await signInWithEmail(email, currentPassword)
        if (verifyError) {
          setErrors({ currentPassword: 'Current password is incorrect' })
          return
        }
      }

      const { error } = await updatePassword(password)

      if (error) {
        setErrors({ general: error })
        return
      }

      onSuccess()
    } catch {
      setErrors({ general: 'An unexpected error occurred. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }, [
    mode,
    email,
    currentPassword,
    password,
    confirmPassword,
    validateCurrentPassword,
    validatePassword,
    validateConfirmPassword,
    onSuccess,
  ])

  return (
    <YStack gap="$3" width="100%">
      <Text fontSize="$5" fontFamily="$body" fontWeight="600">
        {title}
      </Text>

      {/* Current Password — change mode only */}
      {mode === 'change' && (
        <YStack gap="$2">
          <Text fontSize="$3" fontFamily="$body" color="$color11">
            Current Password
          </Text>
          <XStack width="100%" position="relative">
            <Input
              value={currentPassword}
              onChangeText={handleCurrentPasswordChange}
              onBlur={handleCurrentPasswordBlur}
              placeholder="••••••••"
              secureTextEntry={!showCurrentPassword}
              autoCapitalize="none"
              autoComplete="password"
              borderColor={errors.currentPassword ? '$red10' : undefined}
              disabled={isLoading}
              flex={1}
              paddingRight="$10"
              returnKeyType="next"
            />
            <Button
              position="absolute"
              right="$2"
              top="50%"
              transform={[{ translateY: -18 }]}
              size="$3"
              chromeless
              onPress={() => setShowCurrentPassword(!showCurrentPassword)}
              icon={showCurrentPassword ? EyeOff : Eye}
              disabled={isLoading}
            />
          </XStack>
          {errors.currentPassword && (
            <Text fontSize="$2" color="$red10" fontFamily="$body">
              {errors.currentPassword}
            </Text>
          )}
        </YStack>
      )}

      {/* New Password */}
      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          New Password
        </Text>
        <XStack width="100%" position="relative">
          <Input
            value={password}
            onChangeText={handlePasswordChange}
            onBlur={handlePasswordBlur}
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password-new"
            borderColor={errors.password ? '$red10' : undefined}
            disabled={isLoading}
            flex={1}
            paddingRight="$10"
            returnKeyType="next"
          />
          <Button
            position="absolute"
            right="$2"
            top="50%"
            transform={[{ translateY: -18 }]}
            size="$3"
            chromeless
            onPress={() => setShowPassword(!showPassword)}
            icon={showPassword ? EyeOff : Eye}
            disabled={isLoading}
          />
        </XStack>
        {errors.password ? (
          <Text fontSize="$2" color="$red10" fontFamily="$body">
            {errors.password}
          </Text>
        ) : (
          <Text fontSize="$2" color="$color10" fontFamily="$body">
            Must be at least {MIN_PASSWORD_LENGTH} characters
          </Text>
        )}
      </YStack>

      {/* Confirm Password */}
      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          Confirm Password
        </Text>
        <XStack width="100%" position="relative">
          <Input
            value={confirmPassword}
            onChangeText={handleConfirmPasswordChange}
            onBlur={handleConfirmPasswordBlur}
            placeholder="••••••••"
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
            autoComplete="password-new"
            borderColor={errors.confirmPassword ? '$red10' : undefined}
            disabled={isLoading}
            flex={1}
            paddingRight="$10"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <Button
            position="absolute"
            right="$2"
            top="50%"
            transform={[{ translateY: -18 }]}
            size="$3"
            chromeless
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            icon={showConfirmPassword ? EyeOff : Eye}
            disabled={isLoading}
          />
        </XStack>
        {errors.confirmPassword && (
          <Text fontSize="$2" color="$red10" fontFamily="$body">
            {errors.confirmPassword}
          </Text>
        )}
      </YStack>

      {/* General Error */}
      {errors.general && (
        <Text fontSize="$3" color="$red10" fontFamily="$body" textAlign="center">
          {errors.general}
        </Text>
      )}

      {/* Actions */}
      <XStack gap="$3" justifyContent="flex-end" marginTop="$2">
        <Button size="$3" variant="outlined" onPress={onCancel} disabled={isLoading}>
          <Text fontFamily="$body">Cancel</Text>
        </Button>
        <Button
          size="$3"
          onPress={handleSubmit}
          disabled={isLoading}
          backgroundColor="$color10"
          hoverStyle={{ backgroundColor: '$color9' }}
          pressStyle={{ backgroundColor: '$color8' }}
        >
          {isLoading ? (
            <Spinner color="$color1" size="small" />
          ) : (
            <Text fontFamily="$body" fontWeight="600" color="$color1">
              {title}
            </Text>
          )}
        </Button>
      </XStack>
    </YStack>
  )
}
