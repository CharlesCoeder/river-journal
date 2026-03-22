/**
 * AuthScreen - Main entry point for authentication
 * Provides tabs/toggle between Login and Signup forms
 * Uses Legend State useObservable for component-scoped form state
 * Form values are cleared when navigating away for privacy
 */

import { useCallback, useMemo } from 'react'
import { YStack, XStack, Text, Button, ScrollView } from '@my/ui'
import { ArrowLeft } from '@tamagui/lucide-icons'
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
    actions.clear()
    router.push('/')
  }, [router, actions])

  const handleBack = () => {
    router.push('/')
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <YStack
        flex={1}
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom="$10"
        alignItems="center"
        $sm={{
          paddingTop: '$6',
        }}
      >
        {/* Back navigation */}
        <XStack width="100%" maxWidth={400}>
          <Button
            size="$3"
            chromeless
            onPress={handleBack}
            icon={ArrowLeft}
            color="$color9"
            opacity={0.6}
            hoverStyle={{ opacity: 1 }}
          />
        </XStack>

        <YStack width="100%" maxWidth={400} gap="$6" paddingTop="$6">
          {/* Header */}
          <YStack alignItems="center" gap="$3">
            <Text fontSize="$8" fontFamily="$body" fontWeight="300" color="$color">
              {activeTab === 'signup' ? 'Create Account' : 'Welcome Back'}
            </Text>
            <Text fontSize="$3" color="$color10" fontFamily="$body" textAlign="center">
              Accounts are optional. Your journal works perfectly without one.
            </Text>
            <Text fontSize="$3" color="$color10" fontFamily="$body" textAlign="center">
              {activeTab === 'signup'
                ? 'Sign up to sync your journal across devices.'
                : 'Log in to access your journal from any device.'}
            </Text>
          </YStack>

          {/* Tab Selector */}
          <XStack borderRadius="$4" backgroundColor="$color3" padding="$1">
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
    </ScrollView>
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
      backgroundColor={isActive ? '$background' : 'transparent'}
      hoverStyle={{ backgroundColor: isActive ? '$background' : '$color4' }}
      pressStyle={{ opacity: 0.8 }}
      onPress={onPress}
      cursor="pointer"
    >
      <Text
        fontSize="$4"
        fontFamily="$body"
        fontWeight={isActive ? '600' : '400'}
        color={isActive ? '$color' : '$color10'}
      >
        {label}
      </Text>
    </XStack>
  )
}
