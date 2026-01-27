/**
 * AuthScreen - Main entry point for authentication
 * Provides tabs/toggle between Login and Signup forms
 * Uses Legend State useObservable for component-scoped form state
 * Form values are cleared when navigating away for privacy
 */

import { useCallback, useMemo } from 'react'
import { YStack, XStack, Text, H2 } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { type ObservableObject } from '@legendapp/state'
import { useObservable, use$ } from '@legendapp/state/react'
import { SignupForm } from './components/SignupForm'
import { LoginForm } from './components/LoginForm'

type AuthTab = 'login' | 'signup'

// Type for the auth form state
export interface AuthFormState {
  activeTab: AuthTab
  email: string
  password: string
  confirmPassword: string
}

// Type for the observable auth form (exported for child components)
export type AuthFormObservable = ObservableObject<AuthFormState>

interface AuthScreenProps {
  initialTab?: AuthTab
}

export function AuthScreen({ initialTab = 'login' }: AuthScreenProps) {
  // Component-scoped observable - resets when AuthScreen unmounts
  const authForm$ = useObservable<AuthFormState>({
    activeTab: initialTab,
    email: '',
    password: '',
    confirmPassword: '',
  })

  const activeTab = use$(authForm$.activeTab)
  const router = useRouter()

  // Memoized actions to avoid recreating on each render
  const actions = useMemo(
    () => ({
      setTab: (tab: AuthTab) => authForm$.activeTab.set(tab),
      setEmail: (email: string) => authForm$.email.set(email),
      setPassword: (password: string) => authForm$.password.set(password),
      setConfirmPassword: (confirmPassword: string) =>
        authForm$.confirmPassword.set(confirmPassword),
      clear: () => {
        authForm$.assign({
          email: '',
          password: '',
          confirmPassword: '',
        })
      },
    }),
    [authForm$]
  )

  const handleAuthSuccess = useCallback(() => {
    // Clear form and navigate back to home
    actions.clear()
    router.push('/')
  }, [router, actions])

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingHorizontal="$4"
      paddingTop="$8"
      justifyContent="flex-start"
      alignItems="center"
    >
      <YStack width="100%" maxWidth={400} gap="$6" paddingVertical="$6">
        {/* Header */}
        <YStack alignItems="center" gap="$2">
          <H2 fontFamily="$body" fontWeight="700" color="$color12">
            {activeTab === 'signup' ? 'Create Account' : 'Welcome Back'}
          </H2>
          <Text fontSize="$4" color="$color11" fontFamily="$body" textAlign="center">
            {activeTab === 'signup'
              ? 'Sign up to sync your journal across devices'
              : 'Log in to access your journal'}
          </Text>
        </YStack>

        {/* Tab Selector */}
        <XStack borderRadius="$4" backgroundColor="$color4" padding="$1">
          <TabButton
            label="Log In"
            isActive={activeTab === 'login'}
            onPress={() => actions.setTab('login')}
          />
          <TabButton
            label="Sign Up"
            isActive={activeTab === 'signup'}
            onPress={() => actions.setTab('signup')}
          />
        </XStack>

        {/* Form */}
        {activeTab === 'signup' ? (
          <SignupForm
            authForm$={authForm$}
            actions={actions}
            onSuccess={handleAuthSuccess}
            onSwitchToLogin={() => actions.setTab('login')}
          />
        ) : (
          <LoginForm
            authForm$={authForm$}
            actions={actions}
            onSuccess={handleAuthSuccess}
            onSwitchToSignup={() => actions.setTab('signup')}
          />
        )}
      </YStack>
    </YStack>
  )
}

// Tab Button Component
interface TabButtonProps {
  label: string
  isActive: boolean
  onPress: () => void
}

function TabButton({ label, isActive, onPress }: TabButtonProps) {
  return (
    <XStack
      flex={1}
      paddingVertical="$2.5"
      justifyContent="center"
      alignItems="center"
      borderRadius="$3"
      backgroundColor={isActive ? '$color1' : 'transparent'}
      hoverStyle={{ backgroundColor: isActive ? '$color1' : '$color3' }}
      pressStyle={{ opacity: 0.8 }}
      onPress={onPress}
      cursor="pointer"
    >
      <Text
        fontSize="$4"
        fontFamily="$body"
        fontWeight={isActive ? '600' : '400'}
        color={isActive ? '$color12' : '$color11'}
      >
        {label}
      </Text>
    </XStack>
  )
}
