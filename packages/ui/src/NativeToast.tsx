import { Toast, useToastState } from '@tamagui/toast'
import { YStack } from 'tamagui'

export const NativeToast = () => {
  const currentToast = useToastState()

  if (!currentToast || currentToast.isHandledNatively) {
    return null
  }

  return (
    <Toast
      key={currentToast.id}
      duration={currentToast.duration}
      viewportName={currentToast.viewportName}
      y="0 enter:-25px exit:-20px"
      opacity="1 enter:0 exit:0"
      scale="1 enter:0.5 exit:1"
      transition="quick"
    >
      <YStack
        paddingVertical="1-5"
        paddingHorizontal="2"
      >
        <Toast.Title lineHeight="20px">{currentToast.title}</Toast.Title>
        {!!currentToast.message && <Toast.Description>{currentToast.message}</Toast.Description>}
      </YStack>
    </Toast>
  )
}
