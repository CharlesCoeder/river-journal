import { useEffect } from 'react'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { SplashScreen, Stack } from 'expo-router'
import { Provider } from 'app/provider'
import { MobileKeyboardProvider } from 'app/provider/keyboard-provider'
import { NativeToast } from '@my/ui/src/NativeToast'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'
import { useTheme } from '@my/ui'
import { PersistenceGate } from 'app/provider/PersistenceGate'
import { PersistentEditor } from 'app/features/journal/components/PersistentEditor'

export const unstable_settings = {
  // Ensure that reloading on `/user` keeps a back button present.
  initialRouteName: 'Home',
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync()

export default function App() {
  const [fontsLoaded, fontsError] = useFonts({
    Inter: require('@tamagui/font-inter/otf/Inter-Medium.otf'),
    InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
    SourceSans3: require('../public/fonts/SourceSans3/SourceSans3-Regular.ttf'),
    SourceSans3Italic: require('../public/fonts/SourceSans3/SourceSans3-Italic.ttf'),
    SourceSans3Bold: require('../public/fonts/SourceSans3/SourceSans3-Bold.ttf'),
    SourceSans3BoldItalic: require('../public/fonts/SourceSans3/SourceSans3-BoldItalic.ttf'),
    PatrickHand: require('../public/fonts/PatrickHand.ttf'),
    // Lato - UI Font
    Lato: require('../public/fonts/Lato/Lato-Regular.ttf'),
    LatoItalic: require('../public/fonts/Lato/Lato-Italic.ttf'),
    LatoBold: require('../public/fonts/Lato/Lato-Bold.ttf'),
    // Lora - Journal Font
    Lora: require('../public/fonts/Lora/Lora-Regular.ttf'),
    LoraItalic: require('../public/fonts/Lora/Lora-Italic.ttf'),
    LoraBold: require('../public/fonts/Lora/Lora-Bold.ttf'),
    LoraBoldItalic: require('../public/fonts/Lora/Lora-BoldItalic.ttf'),
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
      <SafeAreaProvider>
        <MobileKeyboardProvider>
          <Provider>
            <TamaguifiedReactNavigationThemeProvider>
              <TamaguifiedSafeAreaView>
                <Stack />
                <PersistentEditor />
                <NativeToast />
              </TamaguifiedSafeAreaView>
            </TamaguifiedReactNavigationThemeProvider>
          </Provider>
        </MobileKeyboardProvider>
      </SafeAreaProvider>
    </PersistenceGate>
  )
}

// React Navigation comes with DefaultTheme (white) and DarkTheme (black).
// But, we tamaguified it (has this been coined yet??) so that we get all of Tamagui's themes and subthemes!
function TamaguifiedReactNavigationThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  const baseTheme = use$(store$.profile.baseTheme) ?? 'light'

  const navigationTheme = {
    ...DefaultTheme,
    dark: baseTheme === 'dark',
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
