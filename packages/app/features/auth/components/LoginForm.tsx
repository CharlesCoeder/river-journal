/**
 * LoginForm component for email/password authentication
 * Receives auth form state via props for component-scoped lifecycle
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Input, Button, Text, Spinner } from '@my/ui'
import { Eye, EyeOff } from '@tamagui/lucide-icons'
import { use$ } from '@legendapp/state/react'
import { signInWithEmail } from 'app/utils'
import type { AuthFormObservable } from '../AuthScreen'

// Actions type matching what AuthScreen provides
interface AuthActions {
  setEmail: (email: string) => void
  setPassword: (password: string) => void
}

interface LoginFormProps {
  authForm$: AuthFormObservable
  actions: AuthActions
  onSuccess?: () => void
  onSwitchToSignup?: () => void
}

export function LoginForm({ authForm$, actions, onSuccess, onSwitchToSignup }: LoginFormProps) {
  // Use state from passed observable
  const email = use$(authForm$.email)
  const password = use$(authForm$.password)

  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({})

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

  // Handle blur validation
  const handleEmailBlur = useCallback(() => {
    const error = validateEmail(email)
    setErrors((prev) => ({ ...prev, email: error }))
  }, [email, validateEmail])

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
      if (errors.password || errors.general) {
        setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
      }
    },
    [actions, errors.password, errors.general]
  )

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    // Clear previous errors
    setErrors({})

    // Validate email
    const emailError = validateEmail(email)
    if (emailError) {
      setErrors({ email: emailError })
      return
    }

    if (!password) {
      setErrors({ password: 'Password is required' })
      return
    }

    setIsLoading(true)

    try {
      const { user, error } = await signInWithEmail(email, password)

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
  }, [email, password, validateEmail, onSuccess])

  return (
    <YStack gap="$4" width="100%">
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
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
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
        {errors.password && (
          <Text fontSize="$2" color="$red10" fontFamily="$body">
            {errors.password}
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
            Log In
          </Text>
        )}
      </Button>

      {/* Switch to Signup */}
      <XStack justifyContent="center" gap="$2" marginTop="$2">
        <Text fontSize="$3" color="$color11" fontFamily="$body">
          Don't have an account?
        </Text>
        <Text
          fontSize="$3"
          color="$color10"
          fontFamily="$body"
          fontWeight="600"
          hoverStyle={{ color: '$color11' }}
          pressStyle={{ opacity: 0.7 }}
          onPress={onSwitchToSignup}
          cursor="pointer"
          textDecorationLine="underline"
        >
          Sign up
        </Text>
      </XStack>
    </YStack>
  )
}
