// EAGER IMPORT — must run before Provider mounts so setMutationDefaults()
// registers at module load. See: packages/app/state/collective/mutations.ts.
import 'app/state/collective/mutations'

// Telemetry is OPT-IN, so init does NOT run here: the consent flag is only
// readable after persistence loads, which happens later than this module. The
// consent-gated Sentry init lives in app/state/initializeApp.ts, after
// the persisted flag is awaited. A late opt-in re-runs init via
// app/utils/telemetry/consent.ts — no restart.

import { useEffect } from 'react'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { SplashScreen, Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Provider } from 'app/provider'
import { MobileKeyboardProvider } from 'app/provider/keyboard-provider'
import { NativeToast } from '@my/ui/src/NativeToast'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useTheme } from '@my/ui'
import { PersistenceGate } from 'app/provider/PersistenceGate'
import { PersistentEditor } from 'app/features/journal/components/PersistentEditor'
import { AppLockOverlay } from 'app/features/settings/AppLockOverlay.native'
import { AppLockPrivacyCover } from 'app/features/settings/AppLockPrivacyCover.native'

export const unstable_settings = {
  initialRouteName: 'index',
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync()

export default function App() {
  const [fontsLoaded, fontsError] = useFonts({
    // Outfit — UI sans-serif (default)
    Outfit: require('../public/fonts/Outfit/Outfit-Regular.ttf'),
    'Outfit-Medium': require('../public/fonts/Outfit/Outfit-Medium.ttf'),
    // Newsreader — Journal serif (default)
    Newsreader: require('../public/fonts/Newsreader/Newsreader-Regular.ttf'),
    'Newsreader-Italic': require('../public/fonts/Newsreader/Newsreader-Italic.ttf'),
    'Newsreader-Medium': require('../public/fonts/Newsreader/Newsreader-Medium.ttf'),
    // Lato — Classic UI sans-serif
    Lato: require('../public/fonts/Lato/Lato-Regular.ttf'),
    'Lato-Bold': require('../public/fonts/Lato/Lato-Bold.ttf'),
    // Lora — Classic journal serif
    Lora: require('../public/fonts/Lora/Lora-Regular.ttf'),
    'Lora-Italic': require('../public/fonts/Lora/Lora-Italic.ttf'),
    // Inter — Clean UI sans-serif
    Inter: require('../public/fonts/Inter/Inter-Regular.ttf'),
    'Inter-Medium': require('../public/fonts/Inter/Inter-Medium.ttf'),
    // Source Serif 4 — Clean journal serif
    SourceSerif4: require('../public/fonts/SourceSerif4/SourceSerif4-Regular.ttf'),
    'SourceSerif4-Italic': require('../public/fonts/SourceSerif4/SourceSerif4-Italic.ttf'),
    'SourceSerif4-Medium': require('../public/fonts/SourceSerif4/SourceSerif4-Medium.ttf'),
  })

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      // Hide the splash screen after the fonts have loaded (or an error was returned) and the UI is ready.
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, fontsError])

  if (!fontsLoaded && !fontsError) {
    return null
  }

  return <RootLayoutNav />
}

function RootLayoutNav() {
  return (
    <PersistenceGate>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <MobileKeyboardProvider>
            <Provider>
              <TamaguifiedReactNavigationThemeProvider>
                <TamaguifiedSafeAreaView>
                  {/*
                    The moderation admin surface (features/moderation/**) is
                    intentionally web + desktop only. Mobile must never contain an
                    admin/ route subtree or import from features/moderation/** —
                    it must not ship in publicly-distributed mobile binaries.
                    Enforced by PR review until the CI grep lands.
                  */}
                  {/*
                    The Slider Hub gesture wrapper is mounted on the home route
                    (app/index.tsx), not here: wrapping the whole Stack made every
                    pushed screen a gesture surface, so a swipe back from the menu
                    was read as a swipe into the editor.
                  */}
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen
                      name="journal"
                      options={{ animation: 'none' }}
                    />
                    {/* Slide left on home → menu slides in from the right on both platforms. */}
                    <Stack.Screen
                      name="menu"
                      options={{ animation: 'slide_from_right' }}
                    />
                    <Stack.Screen name="auth" />
                    <Stack.Screen name="privacy" />
                    <Stack.Screen
                      name="google-auth"
                      options={{ animation: 'none' }}
                    />
                  </Stack>
                  <PersistentEditor />
                  <NativeToast />
                  {/* App Lock — covers all routes. The privacy cover hides
                  content from the OS app-switcher snapshot on `inactive`; the
                  overlay gates the UI while locked. */}
                  <AppLockPrivacyCover />
                  <AppLockOverlay />
                </TamaguifiedSafeAreaView>
              </TamaguifiedReactNavigationThemeProvider>
            </Provider>
          </MobileKeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </PersistenceGate>
  )
}

// React Navigation comes with DefaultTheme (white) and DarkTheme (black).
// But, we tamaguified it (has this been coined yet??) so that we get all of Tamagui's themes and subthemes!
function TamaguifiedReactNavigationThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  const themeName = use$(store$.profile.themeName) ?? 'ink'
  const isDark = ['night', 'forest-night', 'fireside'].includes(themeName)

  const navigationTheme = {
    ...DefaultTheme,
    dark: isDark,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.color?.val ?? DefaultTheme.colors.primary,
      background: theme.background?.val ?? DefaultTheme.colors.background,
      card: theme.backgroundStrong?.val ?? theme.background?.val ?? DefaultTheme.colors.card,
      text: theme.color?.val ?? DefaultTheme.colors.text,
      border: theme.borderColor?.val ?? DefaultTheme.colors.border,
      notification: theme.red10?.val ?? DefaultTheme.colors.notification,
    },
  }

  return <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>
}

// Similarly, we tamaguify the SafeAreaView
function TamaguifiedSafeAreaView({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  const backgroundColor = theme.background?.val ?? '#fff'
  return <SafeAreaView style={{ flex: 1, backgroundColor }}>{children}</SafeAreaView>
}
