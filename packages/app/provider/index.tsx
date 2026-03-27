import {
  CustomToast,
  TamaguiProvider,
  type TamaguiProviderProps,
  Theme,
  ToastProvider,
  config,
  isWeb,
} from '@my/ui'
import { ToastViewport } from './ToastViewport'
import { use$ } from '@legendapp/state/react'
import { store$, isDarkTheme } from 'app/state/store'
import { DEFAULT_THEME } from 'app/state/types'

export function Provider({ children, ...rest }: Omit<TamaguiProviderProps, 'config' | 'defaultTheme'>) {
  const themeName = use$(store$.profile.themeName) ?? DEFAULT_THEME
  const baseTheme = isDarkTheme(themeName) ? 'dark' : 'light'

  return (
    <TamaguiProvider config={config} defaultTheme={baseTheme} {...rest}>
      <Theme name={themeName}>
        <ToastProvider swipeDirection="horizontal" duration={6000} native={isWeb ? [] : ['mobile']}>
          {children}
          <CustomToast />
          <ToastViewport />
        </ToastProvider>
      </Theme>
    </TamaguiProvider>
  )
}
