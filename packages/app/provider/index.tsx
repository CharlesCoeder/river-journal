import {
  CustomToast,
  TamaguiProvider,
  type TamaguiProviderProps,
  ToastProvider,
  config,
  isWeb,
} from '@my/ui'
import { ToastViewport } from './ToastViewport'
import { use$ } from '@legendapp/state/react'
import { store$ } from 'app/state/store'

export function Provider({ children, ...rest }: Omit<TamaguiProviderProps, 'config'>) {
  const baseTheme = use$(store$.profile.baseTheme) ?? 'light'

  return (
    <TamaguiProvider config={config} defaultTheme={baseTheme} {...rest}>
      <ToastProvider swipeDirection="horizontal" duration={6000} native={isWeb ? [] : ['mobile']}>
        {children}
        <CustomToast />
        <ToastViewport />
      </ToastProvider>
    </TamaguiProvider>
  )
}
