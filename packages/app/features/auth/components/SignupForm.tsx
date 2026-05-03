/**
 * SignupForm component for email/password account creation
 * Design: bottom-border serif inputs, uppercase micro buttons, "or" divider
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Text, Spinner, View } from '@my/ui'
import { DesignInput } from './DesignInput'
import { use$ } from '@legendapp/state/react'
import { signUpWithEmail } from 'app/utils'
import type { AuthFormObservable } from '../AuthScreen'
import { GoogleSignInButton } from './GoogleSignInButton'

interface AuthActions {
  setEmail: (email: string) => void
  setPassword: (password: string) => void
  setConfirmPassword: (confirmPassword: string) => void
}

interface SignupFormProps {
  authForm$: AuthFormObservable
  actions: AuthActions
  onSuccess?: () => void
  onSwitchToLogin?: () => void
}

const MIN_PASSWORD_LENGTH = 8

export function SignupForm({ authForm$, actions, onSuccess, onSwitchToLogin }: SignupFormProps) {
  const email = use$(authForm$.email)
  const password = use$(authForm$.password)
  const confirmPassword = use$(authForm$.confirmPassword)

  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})

  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address'
    return undefined
  }, [])

  const validatePassword = useCallback((value: string): string | undefined => {
    if (!value) return 'Password is required'
    if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
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

  // Only validate on blur if the field has been touched (has content)
  const handleEmailBlur = useCallback(() => {
    if (email) setErrors((prev) => ({ ...prev, email: validateEmail(email) }))
  }, [email, validateEmail])

  const handlePasswordBlur = useCallback(() => {
    if (password) setErrors((prev) => ({ ...prev, password: validatePassword(password) }))
  }, [password, validatePassword])

  const handleConfirmPasswordBlur = useCallback(() => {
    if (confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: validateConfirmPassword(confirmPassword) }))
  }, [confirmPassword, validateConfirmPassword])

  const handleEmailChange = useCallback(
    (value: string) => {
      actions.setEmail(value)
      if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
    },
    [actions, errors.email]
  )

  const handlePasswordChange = useCallback(
    (value: string) => {
      actions.setPassword(value)
      if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
    },
    [actions, errors.password]
  )

  const handleConfirmPasswordChange = useCallback(
    (value: string) => {
      actions.setConfirmPassword(value)
      if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
    },
    [actions, errors.confirmPassword]
  )

  const handleSubmit = useCallback(async () => {
    setErrors({})
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    const confirmPasswordError = validateConfirmPassword(confirmPassword)

    if (emailError || passwordError || confirmPasswordError) {
      setErrors({ email: emailError, password: passwordError, confirmPassword: confirmPasswordError })
      return
    }

    setIsLoading(true)
    try {
      const { user, error } = await signUpWithEmail(email, password)
      if (error) { setErrors({ general: error }); return }
      if (user) onSuccess?.()
    } finally {
      setIsLoading(false)
    }
  }, [email, password, confirmPassword, validateEmail, validatePassword, validateConfirmPassword, onSuccess])

  const canSubmit = !!email && !!password && !!confirmPassword && !isLoading

  return (
    <YStack gap="$5" width="100%">
      {/* Email */}
      <YStack>
        <DesignInput
          value={email}
          onChangeText={handleEmailChange}
          onBlur={handleEmailBlur}
          placeholder="Email address"
          disabled={isLoading}
          autoComplete="email"
          onSubmitEditing={handleSubmit}
        />
        {errors.email && (
          <Text fontSize={12} color="$color" fontFamily="$body" marginTop="$1">
            {errors.email}
          </Text>
        )}
      </YStack>

      {/* Password */}
      <YStack>
        <DesignInput
          value={password}
          onChangeText={handlePasswordChange}
          onBlur={handlePasswordBlur}
          placeholder="Password"
          secureTextEntry={!showPassword}
          disabled={isLoading}
          showToggle
          onToggleShow={() => setShowPassword(!showPassword)}
          autoComplete="new-password"
          onSubmitEditing={handleSubmit}
        />
        {errors.password && (
          <Text fontSize={12} color="$color" fontFamily="$body" marginTop="$1">
            {errors.password}
          </Text>
        )}
      </YStack>

      {/* Confirm Password */}
      <YStack>
        <DesignInput
          value={confirmPassword}
          onChangeText={handleConfirmPasswordChange}
          onBlur={handleConfirmPasswordBlur}
          placeholder="Confirm Password"
          secureTextEntry={!showPassword}
          disabled={isLoading}
          autoComplete="new-password"
          onSubmitEditing={handleSubmit}
        />
        {errors.confirmPassword && (
          <Text fontSize={12} color="$color" fontFamily="$body" marginTop="$1">
            {errors.confirmPassword}
          </Text>
        )}
      </YStack>

      {/* Error */}
      {errors.general && (
        <Text fontSize={12} color="$color" fontFamily="$body" textAlign="center">
          {errors.general}
        </Text>
      )}

      {/* Submit Button */}
      <XStack
        onPress={canSubmit ? handleSubmit : undefined}
        borderWidth={1}
        borderColor={canSubmit ? '$color' : '$color3'}
        paddingVertical="$3"
        justifyContent="center"
        cursor={canSubmit ? 'pointer' : 'not-allowed'}
        hoverStyle={canSubmit ? { backgroundColor: '$color' } : {}}
        marginTop="$3"
        group="submitBtn"
      >
        {isLoading ? (
          <Spinner />
        ) : (
          <Text
            fontFamily="$body"
            fontSize={12}
            letterSpacing={3}
            textTransform="uppercase"
            color={canSubmit ? '$color' : '$color7'}
            {...(canSubmit ? { '$group-submitBtn-hover': { color: '$background' } } : {})}
          >
            Create Account
          </Text>
        )}
      </XStack>

      {/* "or" divider */}
      <XStack alignItems="center" gap="$3" width="100%" marginTop="$2">
        <View flex={1} height={1} backgroundColor="$color3" />
        <Text fontFamily="$body" fontSize={10} letterSpacing={3} textTransform="uppercase" color="$color7">
          or
        </Text>
        <View flex={1} height={1} backgroundColor="$color3" />
      </XStack>

      {/* Google OAuth */}
      <GoogleSignInButton onSuccess={onSuccess} />

    </YStack>
  )
}
