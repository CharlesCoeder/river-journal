/**
 * AuthScreen - Main entry point for authentication
 * Design: full-screen modal with tab-based login/signup, bottom-border inputs,
 * uppercase micro labels, "or" divider, Google button.
 *
 * Form fields are rendered inline so AnimatePresence can animate the confirm
 * password field in/out when switching between login and signup tabs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, YStack, XStack, Text, ScrollView, View, Spinner } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { useObservable, use$ } from '@legendapp/state/react'
import { DesignInput } from './components/DesignInput'
import { GoogleSignInButton } from './components/GoogleSignInButton'
import { signInWithEmail, signUpWithEmail } from 'app/utils'

type AuthTab = 'login' | 'signup'

export interface AuthFormState {
  activeTab: AuthTab
  email: string
  password: string
  confirmPassword: string
}

const MIN_PASSWORD_LENGTH = 8

interface AuthScreenProps {
  initialTab?: AuthTab
}

export function AuthScreen({ initialTab = 'login' }: AuthScreenProps) {
  const authForm$ = useObservable<AuthFormState>({
    activeTab: initialTab,
    email: '',
    password: '',
    confirmPassword: '',
  })

  const activeTab = use$(authForm$.activeTab)
  const email = use$(authForm$.email)
  const password = use$(authForm$.password)
  const confirmPassword = use$(authForm$.confirmPassword)
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})

  useEffect(() => { setMounted(true) }, [])

  const isSignup = activeTab === 'signup'

  const setTab = useCallback((tab: AuthTab) => {
    authForm$.activeTab.set(tab)
    setErrors({})
  }, [authForm$])

  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address'
    return undefined
  }, [])

  const validatePassword = useCallback((value: string): string | undefined => {
    if (!value) return 'Password is required'
    if (isSignup && value.length < MIN_PASSWORD_LENGTH)
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    return undefined
  }, [isSignup])

  const validateConfirmPassword = useCallback(
    (value: string): string | undefined => {
      if (!value) return 'Please confirm your password'
      if (value !== password) return 'Passwords do not match'
      return undefined
    },
    [password]
  )

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
      authForm$.email.set(value)
      if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
    },
    [authForm$, errors.email]
  )

  const handlePasswordChange = useCallback(
    (value: string) => {
      authForm$.password.set(value)
      if (errors.password || errors.general) setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
    },
    [authForm$, errors.password, errors.general]
  )

  const handleConfirmPasswordChange = useCallback(
    (value: string) => {
      authForm$.confirmPassword.set(value)
      if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
    },
    [authForm$, errors.confirmPassword]
  )

  const handleSubmit = useCallback(async () => {
    setErrors({})
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)

    if (isSignup) {
      const confirmError = validateConfirmPassword(confirmPassword)
      if (emailError || passwordError || confirmError) {
        setErrors({ email: emailError, password: passwordError, confirmPassword: confirmError })
        return
      }
      setIsLoading(true)
      try {
        const { user, error } = await signUpWithEmail(email, password)
        if (error) { setErrors({ general: error }); return }
        if (user) { authForm$.assign({ email: '', password: '', confirmPassword: '' }); router.push('/') }
      } finally {
        setIsLoading(false)
      }
    } else {
      if (emailError) { setErrors({ email: emailError }); return }
      if (!password) { setErrors({ password: 'Password is required' }); return }
      setIsLoading(true)
      try {
        const { user, error } = await signInWithEmail(email, password)
        if (error) { setErrors({ general: error }); return }
        if (user) { authForm$.assign({ email: '', password: '', confirmPassword: '' }); router.push('/') }
      } finally {
        setIsLoading(false)
      }
    }
  }, [email, password, confirmPassword, isSignup, validateEmail, validatePassword, validateConfirmPassword, authForm$, router])

  const canSubmit = isSignup
    ? !!email && !!password && !!confirmPassword && !isLoading
    : !!email && !!password && !isLoading

  const handleBack = () => { router.push('/') }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <AnimatePresence>
        {mounted && (
          <YStack
            key="auth-content"
            transition="designModal"
            enterStyle={{ opacity: 0, scale: 0.98 }}
            opacity={1}
            scale={1}
            flex={1}
            paddingHorizontal="$4"
            paddingTop="$4"
            paddingBottom={96}
            alignItems="center"
            $sm={{ paddingHorizontal: '$6' }}
            $md={{ paddingHorizontal: '$12', paddingTop: '$12' }}
          >
        {/* Cancel button — top right, wider than form */}
        <XStack width="100%" maxWidth={576} justifyContent="flex-end">
          <Text
            fontFamily="$body"
            fontSize={12}
            letterSpacing={3}
            textTransform="uppercase"
            color="$color8"
            cursor="pointer"
            hoverStyle={{ color: '$color' }}
            onPress={handleBack}
          >
            Cancel
          </Text>
        </XStack>

        {/* Header */}
        <YStack alignItems="center" gap="$3" paddingTop={48} marginBottom={48}>
          <Text
            fontFamily="$journal"
            fontSize={30}
            $md={{ fontSize: 36 }}
            color="$color"
            letterSpacing={-0.5}
          >
            Your Journal
          </Text>
          <Text
            fontFamily="$body"
            fontSize={16}
            color="$color6"
            textAlign="center"
          >
            Accounts are optional. Your journal works perfectly without one.
          </Text>
        </YStack>

        <YStack width="100%" maxWidth={384} gap="$6" alignItems="center">
          {/* Tab bar */}
          <XStack
            width="100%"
            borderBottomWidth={1}
            borderColor="$color4"
            marginBottom="$4"
          >
            <TabButton
              label="Log In"
              isActive={activeTab === 'login'}
              onPress={() => setTab('login')}
            />
            <TabButton
              label="Sign Up"
              isActive={activeTab === 'signup'}
              onPress={() => setTab('signup')}
            />
          </XStack>

          {/* Form fields */}
          <YStack width="100%">
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
            <YStack marginTop="$5">
              <DesignInput
                value={password}
                onChangeText={handlePasswordChange}
                onBlur={handlePasswordBlur}
                placeholder="Password"
                secureTextEntry={!showPassword}
                disabled={isLoading}
                showToggle
                onToggleShow={() => setShowPassword(!showPassword)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                onSubmitEditing={handleSubmit}
              />
              {errors.password && (
                <Text fontSize={12} color="$color" fontFamily="$body" marginTop="$1">
                  {errors.password}
                </Text>
              )}
            </YStack>

            {/* Confirm Password — collapses smoothly on tab switch */}
            <YStack
              transition="smoothCollapse"
              overflow="hidden"
              height={isSignup ? 64 : 0}
              pointerEvents={isSignup ? 'auto' : 'none'}
            >
              <YStack transition="smoothCollapse" opacity={isSignup ? 1 : 0} paddingTop={20}>
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
            </YStack>

            {/* Error */}
            {errors.general && (
              <Text fontSize={12} color="$color" fontFamily="$body" textAlign="center" marginTop="$5">
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
              marginTop="$5"
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
                  {isSignup ? 'Create Account' : 'Log In'}
                </Text>
              )}
            </XStack>

            {/* "or" divider */}
            <XStack alignItems="center" gap="$3" width="100%" marginTop="$5">
              <View flex={1} height={1} backgroundColor="$color3" />
              <Text fontFamily="$body" fontSize={10} letterSpacing={3} textTransform="uppercase" color="$color7">
                or
              </Text>
              <View flex={1} height={1} backgroundColor="$color3" />
            </XStack>

            {/* Google OAuth */}
            <YStack marginTop="$5" width="100%">
              <GoogleSignInButton />
            </YStack>
          </YStack>
        </YStack>
          </YStack>
        )}
      </AnimatePresence>
    </ScrollView>
  )
}

function TabButton({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  return (
    <XStack
      flex={1}
      paddingBottom="$2"
      justifyContent="center"
      alignItems="center"
      borderBottomWidth={isActive ? 2 : 0}
      borderColor="$color"
      cursor="pointer"
      onPress={onPress}
    >
      <Text
        fontFamily="$body"
        fontSize={12}
        letterSpacing={3}
        textTransform="uppercase"
        fontWeight={isActive ? '500' : '400'}
        color={isActive ? '$color' : '$color8'}
        hoverStyle={{ color: '$color' }}
      >
        {label}
      </Text>
    </XStack>
  )
}
