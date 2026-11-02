import { isWeb, Toast, YStack } from 'tamagui'

// Mount once inside TamaguiProvider; `toast()` then works from anywhere. Native
// shows the OS toast through burnt. Web keeps the app's own toast surface.
export const CustomToast = () => (
  <Toast
    position="top-center"
    duration={6000}
    native={!isWeb}
  >
    <Toast.Viewport offset={10}>
      <Toast.List
        renderItem={({ toast, index }) => (
          <Toast.Item
            key={toast.id}
            toast={toast}
            index={index}
            backgroundColor="color6"
            borderRadius="4"
            paddingHorizontal="4"
            paddingVertical="3"
          >
            <YStack
              paddingVertical="1-5"
              paddingHorizontal="2"
            >
              <Toast.Title lineHeight="20px">{toast.title}</Toast.Title>
              {!!toast.description && <Toast.Description>{toast.description}</Toast.Description>}
            </YStack>
          </Toast.Item>
        )}
      />
    </Toast.Viewport>
  </Toast>
)
