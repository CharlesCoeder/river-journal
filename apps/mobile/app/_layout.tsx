import { useEffect } from 'react'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { SplashScreen, Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Provider } from 'app/provider'
import { MobileKeyboardProvider } from 'app/provider/keyboard-provider'
import { SliderHub } from 'app/features/navigation/SliderHub'
import { NativeToast } from '@my/ui/src/NativeToast'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useTheme } from '@my/ui'
import { PersistenceGate } from 'app/provider/PersistenceGate'
import { PersistentEditor } from 'app/features/journal/components/PersistentEditor'

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
                <SliderHub>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="journal" options={{ animation: 'none' }} />
                    <Stack.Screen name="auth" />
                    <Stack.Screen name="privacy" />
                    <Stack.Screen
                      name="google-auth"
                      options={{ animation: 'none' }}
                    />
                  </Stack>
                </SliderHub>
                <PersistentEditor />
                <NativeToast />
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
