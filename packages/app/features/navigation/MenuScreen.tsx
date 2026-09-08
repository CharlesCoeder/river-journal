import { Text, View, XStack, YStack } from '@my/ui'
import { X } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { MenuSurface } from './MenuSurface'
import { useHubPager } from './hubPagerContext'

/**
 * The mobile menu: a quiet header with a close control above the menu
 * surface. Inside the hub pager (home's right-hand pane) closing slides home;
 * as a plain route it pops.
 */
export function MenuScreen() {
  const router = useRouter()
  const hub = useHubPager()

  const close = () => {
    if (hub) {
      hub.goTo('/')
      return
    }
    router.back()
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
