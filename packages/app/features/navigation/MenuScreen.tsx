import { View, XStack, YStack } from '@my/ui'
import { X } from '@tamagui/lucide-icons'
import { useRouter } from 'solito/navigation'
import { MenuSurface } from './MenuSurface'
import { useHubPager } from './hubPagerContext'

/**
 * The mobile menu: a close control above the menu surface. Inside the hub
 * pager (home's right-hand pane) closing slides home; as a plain route it
 * pops.
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
      {/* No title: the word "Menu" is the link on home that pulls this pane in,
          and mid-slide the two would sit side by side. The close control takes
          the link's place as the pane arrives. */}
      <XStack
        paddingHorizontal="$6"
        paddingTop="$3"
        alignItems="center"
        justifyContent="flex-end"
        minHeight={44}
      >
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
