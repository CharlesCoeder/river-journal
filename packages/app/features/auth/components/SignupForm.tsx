/**
 * SignupForm component for email/password account creation
 * Implements AC #1 (signup form) and AC #3 (validation/errors)
 * Receives auth form state via props for component-scoped lifecycle
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Input, Button, Text, Spinner } from '@my/ui'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import { use$ } from '@legendapp/state/react'
import { signUpWithEmail } from 'app/utils'
import type { AuthFormObservable } from '../AuthScreen'
import { GoogleSignInButton } from './GoogleSignInButton'
import { OAuthDivider } from './OAuthDivider'

// Actions type matching what AuthScreen provides
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

// Password requirements
const MIN_PASSWORD_LENGTH = 8

export function SignupForm({ authForm$, actions, onSuccess, onSwitchToLogin }: SignupFormProps) {
  // Use state from passed observable
  const email = use$(authForm$.email)
  const password = use$(authForm$.password)
  const confirmPassword = use$(authForm$.confirmPassword)

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})

  // Validate email format
  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) {
      return 'Email is required'
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(value)) {
      return 'Please enter a valid email address'
    }
    return undefined
  }, [])

  // Validate password
  const validatePassword = useCallback((value: string): string | undefined => {
    if (!value) {
      return 'Password is required'
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    }
    return undefined
  }, [])

  // Validate confirm password
  const validateConfirmPassword = useCallback(
    (value: string): string | undefined => {
      if (!value) {
        return 'Please confirm your password'
      }
      if (value !== password) {
        return 'Passwords do not match'
      }
      return undefined
    },
    [password]
  )

  // Handle blur validation
  const handleEmailBlur = useCallback(() => {
    const error = validateEmail(email)
    setErrors((prev) => ({ ...prev, email: error }))
  }, [email, validateEmail])

  const handlePasswordBlur = useCallback(() => {
    const error = validatePassword(password)
    setErrors((prev) => ({ ...prev, password: error }))
  }, [password, validatePassword])

  const handleConfirmPasswordBlur = useCallback(() => {
    const error = validateConfirmPassword(confirmPassword)
    setErrors((prev) => ({ ...prev, confirmPassword: error }))
  }, [confirmPassword, validateConfirmPassword])

  // Clear error when user starts typing
  const handleEmailChange = useCallback(
    (value: string) => {
      actions.setEmail(value)
      if (errors.email) {
        setErrors((prev) => ({ ...prev, email: undefined }))
      }
    },
    [actions, errors.email]
  )

  const handlePasswordChange = useCallback(
    (value: string) => {
      actions.setPassword(value)
      if (errors.password) {
        setErrors((prev) => ({ ...prev, password: undefined }))
      }
    },
    [actions, errors.password]
  )

  const handleConfirmPasswordChange = useCallback(
    (value: string) => {
      actions.setConfirmPassword(value)
      if (errors.confirmPassword) {
        setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
      }
    },
    [actions, errors.confirmPassword]
  )

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    // Clear previous errors
    setErrors({})

    // Validate all fields
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    const confirmPasswordError = validateConfirmPassword(confirmPassword)

    if (emailError || passwordError || confirmPasswordError) {
      setErrors({
        email: emailError,
        password: passwordError,
        confirmPassword: confirmPasswordError,
      })
      return
    }

    setIsLoading(true)

    try {
      const { user, error } = await signUpWithEmail(email, password)

      if (error) {
        setErrors({ general: error })
        return
      }

      if (user) {
        onSuccess?.()
      }
    } finally {
      setIsLoading(false)
    }
  }, [
    email,
    password,
    confirmPassword,
    validateEmail,
    validatePassword,
    validateConfirmPassword,
    onSuccess,
  ])

  return (
    <YStack gap="$4" width="100%">
      {/* Google OAuth */}
      <GoogleSignInButton onSuccess={onSuccess} />
      <OAuthDivider />

      {/* Email Input */}
      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          Email
        </Text>
        <Input
          value={email}
          onChangeText={handleEmailChange}
          onBlur={handleEmailBlur}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          borderColor={errors.email ? '$red10' : undefined}
          disabled={isLoading}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        {errors.email && (
          <Text fontSize="$2" color="$red10" fontFamily="$body">
            {errors.email}
          </Text>
        )}
      </YStack>

      {/* Password Input */}
      <YStack gap="$2">
        <Text fontSize="$3" fontFamily="$body" color="$color11">
          Password
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

      {/* Confirm Password Input */}
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

      {/* Submit Button */}
      <Button
        onPress={handleSubmit}
        disabled={isLoading}
        backgroundColor="$color10"
        hoverStyle={{ backgroundColor: '$color9' }}
        pressStyle={{ backgroundColor: '$color8' }}
        marginTop="$2"
      >
        {isLoading ? (
          <Spinner color="$color1" />
        ) : (
          <Text fontFamily="$body" fontWeight="600" color="$color1">
            Sign Up
          </Text>
        )}
      </Button>

      {/* Switch to Login */}
      <XStack justifyContent="center" gap="$2" marginTop="$2">
        <Text fontSize="$3" color="$color11" fontFamily="$body">
          Already have an account?
        </Text>
        <Text
          fontSize="$3"
          color="$color10"
          fontFamily="$body"
          fontWeight="600"
          hoverStyle={{ color: '$color11' }}
          pressStyle={{ opacity: 0.7 }}
          onPress={onSwitchToLogin}
          cursor="pointer"
          textDecorationLine="underline"
        >
          Log in
        </Text>
      </XStack>
    </YStack>
  )
}
