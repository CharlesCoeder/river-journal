import {
  AlertDialog as TamaguiAlertDialog,
  Dialog as TamaguiDialog,
  isWeb,
  styled,
  withStaticProperties,
} from 'tamagui'

// Tamagui 3's size ladder would set the font, size and leading of dialog descriptions
// on native, so native opts out of it. Exported from the package barrel, where these
// take precedence over `export * from 'tamagui'`.
export const Dialog = isWeb
  ? TamaguiDialog
  : withStaticProperties(TamaguiDialog, {
      Description: styled(TamaguiDialog.Description, { size: false } as object),
    })

export const AlertDialog = isWeb
  ? TamaguiAlertDialog
  : withStaticProperties(TamaguiAlertDialog, {
      Description: styled(TamaguiAlertDialog.Description, { size: false } as object),
    })
