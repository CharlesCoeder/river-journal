/**
 * Paid tier coming-soon stub route for Expo Router.
 * STUB destination — Story 7.4 wires the real PaidTierPurchaseSurface.
 */

import { useRouter } from 'solito/navigation'
import { YStack, View, Text } from 'tamagui'

export default function PaidComingSoonRoute() {
  const router = useRouter()

  return (
    <YStack flex={1} alignItems="center" justifyContent="center" gap="$4">
      <Text>Paid tier coming soon</Text>
      <View onPress={() => router.back()} cursor="pointer" role="button" aria-label="Back">
        <Text>Back</Text>
      </View>
    </YStack>
  )
}
