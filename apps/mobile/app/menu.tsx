import { Text, View, XStack, YStack } from '@my/ui'
import { X } from '@tamagui/lucide-icons'
import { useRouter } from 'expo-router'
import { MenuSurface } from 'app/features/navigation/MenuSurface'

export default function MenuScreen() {
  const router = useRouter()

  // The menu is always pushed on top of home, so back() lands on home. The
  // replace() branch is a deep-link safety net only.
  const close = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
    >
      <XStack
        paddingHorizontal="$6"
        paddingTop="$3"
        alignItems="center"
        justifyContent="space-between"
      >
        <Text
          fontFamily="$body"
          fontSize={14}
          color="$color8"
          letterSpacing={1}
          textTransform="uppercase"
          paddingLeft="$2"
        >
          Menu
        </Text>
        <View
          role="button"
          aria-label="Close menu"
          cursor="pointer"
          width={44}
          height={44}
          marginRight={-12}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.6 }}
          onPress={close}
        >
          <X
            size={20}
            color="$color9"
          />
        </View>
      </XStack>
      <MenuSurface />
    </YStack>
  )
}
