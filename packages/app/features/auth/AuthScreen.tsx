/**
 * AuthScreen - Main entry point for authentication
 * Design: full-screen modal with tab-based login/signup, bottom-border inputs,
 * uppercase micro labels, "or" divider, Google button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, YStack, XStack, Text, ScrollView, View } from '@my/ui'
import { useRouter } from 'solito/navigation'
import { type ObservableObject } from '@legendapp/state'
import { useObservable, use$ } from '@legendapp/state/react'
import { SignupForm } from './components/SignupForm'
import { LoginForm } from './components/LoginForm'

type AuthTab = 'login' | 'signup'

export interface AuthFormState {
  activeTab: AuthTab
  email: string
  password: string
  confirmPassword: string
}

export type AuthFormObservable = ObservableObject<AuthFormState>

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
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

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

        {/* Header — wider than form so text fits one line */}
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
              onPress={() => actions.setTab('login')}
            />
            <TabButton
              label="Sign Up"
              isActive={activeTab === 'signup'}
              onPress={() => actions.setTab('signup')}
            />
          </XStack>

          {/* Form */}
          <AnimatePresence>
            {activeTab === 'signup' ? (
              <YStack key="signup-form" transition="quick" enterStyle={{ opacity: 0, y: 10 }} exitStyle={{ opacity: 0, y: -10 }} opacity={1} y={0} width="100%">
                <SignupForm
                  authForm$={authForm$}
                  actions={actions}
                  onSuccess={handleAuthSuccess}
                  onSwitchToLogin={() => actions.setTab('login')}
                />
              </YStack>
            ) : (
              <YStack key="login-form" transition="quick" enterStyle={{ opacity: 0, y: 10 }} exitStyle={{ opacity: 0, y: -10 }} opacity={1} y={0} width="100%">
                <LoginForm
                  authForm$={authForm$}
                  actions={actions}
                  onSuccess={handleAuthSuccess}
                  onSwitchToSignup={() => actions.setTab('signup')}
                />
              </YStack>
            )}
          </AnimatePresence>
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
