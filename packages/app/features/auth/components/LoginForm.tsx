/**
 * LoginForm component for email/password authentication
 * Design: bottom-border serif inputs, uppercase micro buttons, "or" divider
 */

import { useState, useCallback } from 'react'
import { YStack, XStack, Text, Spinner, View } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { DesignInput } from './DesignInput'
import { signInWithEmail } from 'app/utils'
import type { AuthFormObservable } from '../AuthScreen'
import { GoogleSignInButton } from './GoogleSignInButton'

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
  const email = use$(authForm$.email)
  const password = use$(authForm$.password)

  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({})

  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address'
    return undefined
  }, [])

  const handleEmailBlur = useCallback(() => {
    if (email) setErrors((prev) => ({ ...prev, email: validateEmail(email) }))
  }, [email, validateEmail])

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
      if (errors.password || errors.general) setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
    },
    [actions, errors.password, errors.general]
  )

  const handleSubmit = useCallback(async () => {
    setErrors({})
    const emailError = validateEmail(email)
    if (emailError) { setErrors({ email: emailError }); return }
    if (!password) { setErrors({ password: 'Password is required' }); return }

    setIsLoading(true)
    try {
      const { user, error } = await signInWithEmail(email, password)
      if (error) { setErrors({ general: error }); return }
      if (user) onSuccess?.()
    } finally {
      setIsLoading(false)
    }
  }, [email, password, validateEmail, onSuccess])

  const canSubmit = !!email && !!password && !isLoading

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
          placeholder="Password"
          secureTextEntry={!showPassword}
          disabled={isLoading}
          showToggle
          onToggleShow={() => setShowPassword(!showPassword)}
          autoComplete="current-password"
          onSubmitEditing={handleSubmit}
        />
        {errors.password && (
          <Text fontSize={12} color="$color" fontFamily="$body" marginTop="$1">
            {errors.password}
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
            Log In
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
