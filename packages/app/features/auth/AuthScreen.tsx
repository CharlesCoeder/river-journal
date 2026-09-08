/**
 * AuthScreen - Main entry point for authentication
 * Design: full-screen modal with tab-based login/signup, bottom-border inputs,
 * uppercase micro labels, "or" divider, Google button.
 *
 * Form fields are rendered inline so AnimatePresence can animate the confirm
 * password field in/out when switching between login and signup tabs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, YStack, XStack, Text, ScrollView, View, Spinner, Checkbox } from '@my/ui'
import { WordLinkNav } from 'app/features/navigation/WordLinkNav'
import { useRouter } from 'solito/navigation'
import type { Observable } from '@legendapp/state'
import { useObservable, use$ } from '@legendapp/state/react'
import { DesignInput } from './components/DesignInput'
import { GoogleSignInButton } from './components/GoogleSignInButton'
import { signInWithEmail, signUpWithEmail, recordAgeAttestation } from 'app/utils'
import { pendingCollectiveReturn$, pendingAgeAttestation$ } from 'app/state/authReturn'

type AuthTab = 'login' | 'signup'

export interface AuthFormState {
  activeTab: AuthTab
  email: string
  password: string
  confirmPassword: string
}

export type AuthFormObservable = Observable<AuthFormState>

const MIN_PASSWORD_LENGTH = 8

interface AuthScreenProps {
  initialTab?: AuthTab
  /**
   * Where this auth surface was reached from. When 'collective', the subtitle
   * swaps to Collective-context copy and a successful auth records a pending
   * return-to-Collective marker (consumed by the home-forward effect once
   * sync readiness opens).
   */
  gateContext?: 'collective'
  /** Post-auth destination requested by the referring surface (e.g. '/collective'). */
  returnTo?: string
}

export function AuthScreen({ initialTab = 'login', gateContext, returnTo }: AuthScreenProps) {
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
  // 13+ attestation — SIGN-UP ONLY. Every existing account attested when it was
  // created, so a returning user is never asked again on the login tab.
  const [ageAttested, setAgeAttested] = useState(false)
  const [attestError, setAttestError] = useState(false)
  // Transient emphasis on the checkbox after a press it blocked, so the reason
  // the tap did nothing is easy to spot. Fades on its own; the inline microcopy
  // stays until the box is checked.
  const [attestPulse, setAttestPulse] = useState(false)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    general?: string
  }>({})

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!attestPulse) return
    const timer = setTimeout(() => setAttestPulse(false), 600)
    return () => clearTimeout(timer)
  }, [attestPulse])

  const isSignup = activeTab === 'signup'

  const setTab = useCallback(
    (tab: AuthTab) => {
      authForm$.activeTab.set(tab)
      setErrors({})
      // The attestation is an affirmation made while creating an account, so it
      // never survives a mode switch: switching to login drops a check the user
      // can no longer see, and coming back to sign-up asks for a fresh one.
      setAgeAttested(false)
      setAttestError(false)
      setAttestPulse(false)
    },
    [authForm$]
  )

  const validateEmail = useCallback((value: string): string | undefined => {
    if (!value.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address'
    return undefined
  }, [])

  const validatePassword = useCallback(
    (value: string): string | undefined => {
      if (!value) return 'Password is required'
      if (isSignup && value.length < MIN_PASSWORD_LENGTH)
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      return undefined
    },
    [isSignup]
  )

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
    if (confirmPassword)
      setErrors((prev) => ({ ...prev, confirmPassword: validateConfirmPassword(confirmPassword) }))
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
      if (errors.password || errors.general)
        setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
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

  const wantsCollectiveReturn = gateContext === 'collective' || returnTo === '/collective'

  const handleAgeAttestedChange = useCallback((checked: boolean | 'indeterminate') => {
    const next = checked === true
    setAgeAttested(next)
    if (next) {
      setAttestError(false)
      setAttestPulse(false)
    }
  }, [])

  /**
   * Gate shared by every account-creating control (the email submit AND the
   * Google button). Returns true when the press may proceed.
   *
   * On the LOGIN tab it always passes: the 13+ box isn't rendered there at all,
   * because every existing account attested at creation and re-asking on each
   * sign-in is noise. On the SIGN-UP tab an unchecked box swallows the press —
   * NO auth call fires — and surfaces the inline nudge instead of the control
   * silently doing nothing.
   */
  const requireAgeAttestation = useCallback(() => {
    if (!isSignup || ageAttested) return true
    setAttestError(true)
    setAttestPulse(true)
    return false
  }, [isSignup, ageAttested])

  // Runs after a session is established (user present, no error) on either
  // email path. Post-auth returns home first (as before) so the device-setup
  // dialogs on the home surface can run; when the user came from the Collective
  // gate, a persisted marker lets home forward them to the Collective once sync
  // readiness opens.
  const completeEmailAuth = useCallback(() => {
    // Always overwrite (never only set-true): a stale marker left by an
    // earlier abandoned auth attempt must self-heal to false when THIS
    // attempt has no collective-return intent, so it can't surprise-forward
    // an unrelated sign-in to /collective.
    pendingCollectiveReturn$.set(wantsCollectiveReturn)
    authForm$.assign({ email: '', password: '', confirmPassword: '' })
    router.push('/')
  }, [wantsCollectiveReturn, authForm$, router])

  const handleSubmit = useCallback(async () => {
    if (!requireAgeAttestation()) return
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
        if (error) {
          setErrors({ general: error })
          return
        }
        if (!user) {
          setErrors({ general: 'Something went wrong. Please try again.' })
          return
        }
        // Attestation is recorded for the ACCOUNT BEING CREATED only, and is
        // best-effort record-keeping — recordAgeAttestation swallows its own
        // failures and never blocks the navigation that follows.
        await recordAgeAttestation(user.id)
        completeEmailAuth()
      } finally {
        setIsLoading(false)
      }
    } else {
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
        if (!user) {
          setErrors({ general: 'Something went wrong. Please try again.' })
          return
        }
        completeEmailAuth()
      } finally {
        setIsLoading(false)
      }
    }
  }, [
    requireAgeAttestation,
    email,
    password,
    confirmPassword,
    isSignup,
    validateEmail,
    validatePassword,
    validateConfirmPassword,
    completeEmailAuth,
  ])

  const canSubmit = isSignup
    ? !!email && !!password && !!confirmPassword && ageAttested && !isLoading
    : !!email && !!password && !isLoading

  // Always attached to the submit control so a sign-up press while the 13+ box
  // is unchecked can surface the inline nudge (still no auth call).
  const handleSubmitPress = useCallback(() => {
    if (!requireAgeAttestation()) return
    if (!canSubmit) return
    void handleSubmit()
  }, [requireAgeAttestation, canSubmit, handleSubmit])

  // Runs only for a Google press that cleared `requireAgeAttestation`, right
  // before OAuth is initiated. On web/desktop the OAuth redirect unloads the
  // page, so no inline post-auth code can run — the persisted markers carry the
  // intent across the redirect and are flushed once a session exists. Both are
  // always overwritten (never only set-true) so an abandoned prior attempt's
  // stale marker can't leak into this one. A login never queues an attestation:
  // that belongs to account creation.
  const handleGoogleAuthStart = useCallback(() => {
    pendingAgeAttestation$.set(isSignup)
    pendingCollectiveReturn$.set(wantsCollectiveReturn)
  }, [isSignup, wantsCollectiveReturn])

  // Native-only inline path: useGoogleAuth fires onSuccess after the session is
  // established, so the store userId is available. Web never calls this (the
  // redirect flow reloads the page); the persisted marker covers it there.
  const handleGoogleSuccess = useCallback(() => {
    if (!isSignup) return
    void recordAgeAttestation()
  }, [isSignup])

  const handleBack = () => {
    router.push('/')
  }

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
            <WordLinkNav variant="browse" />
            {/* Cancel button — top right, wider than form */}
            <XStack
              width="100%"
              maxWidth={576}
              justifyContent="flex-end"
            >
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
            <YStack
              alignItems="center"
              gap="$3"
              paddingTop={48}
              marginBottom={48}
            >
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
                {gateContext === 'collective'
                  ? "To join the Collective, you'll need an account."
                  : 'Accounts are optional. Your journal works perfectly without one.'}
              </Text>
            </YStack>

            <YStack
              width="100%"
              maxWidth={384}
              gap="$6"
              alignItems="center"
            >
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
                {/* 13+ attestation — sign-up only; required before an account is created */}
                {isSignup && (
                  <YStack
                    transition="designModal"
                    enterStyle={{ opacity: 0 }}
                    opacity={1}
                    marginBottom="$5"
                    gap="$2"
                  >
                    <XStack
                      alignItems="center"
                      gap="$3"
                    >
                      {/* Wrapper carries the nudge pulse so the checkbox's own
                          styling stays declarative. */}
                      <View
                        transition="quick"
                        scale={attestPulse ? 1.15 : 1}
                      >
                        <Checkbox
                          checked={ageAttested}
                          onCheckedChange={handleAgeAttestedChange}
                          accessibilityLabel="I confirm I am 13 or older."
                          testID="age-attestation-checkbox"
                          size="$4"
                          borderRadius={0}
                          borderWidth={1}
                          borderColor={attestError ? '$color' : '$color6'}
                          backgroundColor={ageAttested ? '$color' : 'transparent'}
                          disabled={isLoading}
                        />
                      </View>
                      <Text
                        fontFamily="$body"
                        fontSize={13}
                        color="$color6"
                        cursor="pointer"
                        onPress={() => handleAgeAttestedChange(!ageAttested)}
                      >
                        I confirm I am 13 or older.
                      </Text>
                    </XStack>
                    {attestError && (
                      <Text
                        fontSize={12}
                        color="$color"
                        fontFamily="$body"
                      >
                        Please confirm you're 13 or older to continue.
                      </Text>
                    )}
                  </YStack>
                )}

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
                    <Text
                      fontSize={12}
                      color="$color"
                      fontFamily="$body"
                      marginTop="$1"
                    >
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
                    <Text
                      fontSize={12}
                      color="$color"
                      fontFamily="$body"
                      marginTop="$1"
                    >
                      {errors.password}
                    </Text>
                  )}
                </YStack>

                {/* Confirm Password — collapses smoothly on tab switch */}
                <YStack
                  transition="smoothCollapse"
                  overflow="hidden"
                  height={isSignup ? 84 : 0}
                  pointerEvents={isSignup ? 'auto' : 'none'}
                >
                  <YStack
                    transition="smoothCollapse"
                    opacity={isSignup ? 1 : 0}
                    paddingTop={20}
                  >
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
                      <Text
                        fontSize={12}
                        color="$color"
                        fontFamily="$body"
                        marginTop="$1"
                      >
                        {errors.confirmPassword}
                      </Text>
                    )}
                  </YStack>
                </YStack>

                {/* Error */}
                {errors.general && (
                  <Text
                    fontSize={12}
                    color="$color"
                    fontFamily="$body"
                    textAlign="center"
                    marginTop="$5"
                  >
                    {errors.general}
                  </Text>
                )}

                {/* Submit Button */}
                <XStack
                  onPress={handleSubmitPress}
                  borderWidth={1}
                  borderColor={canSubmit ? '$color' : '$color3'}
                  paddingVertical="$3"
                  justifyContent="center"
                  cursor={canSubmit ? 'pointer' : 'not-allowed'}
                  hoverStyle={canSubmit ? { backgroundColor: '$color' } : {}}
                  marginTop="$5"
                  group={'submitBtn' as never}
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
                <XStack
                  alignItems="center"
                  gap="$3"
                  width="100%"
                  marginTop="$5"
                >
                  <View
                    flex={1}
                    height={1}
                    backgroundColor="$color3"
                  />
                  <Text
                    fontFamily="$body"
                    fontSize={10}
                    letterSpacing={3}
                    textTransform="uppercase"
                    color="$color7"
                  >
                    or
                  </Text>
                  <View
                    flex={1}
                    height={1}
                    backgroundColor="$color3"
                  />
                </XStack>

                {/* Google OAuth */}
                <YStack
                  marginTop="$5"
                  width="100%"
                >
                  <GoogleSignInButton
                    canStart={requireAgeAttestation}
                    onAuthStart={handleGoogleAuthStart}
                    onSuccess={handleGoogleSuccess}
                  />
                </YStack>
              </YStack>
            </YStack>
          </YStack>
        )}
      </AnimatePresence>
    </ScrollView>
  )
}

function TabButton({
  label,
  isActive,
  onPress,
}: { label: string; isActive: boolean; onPress: () => void }) {
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
