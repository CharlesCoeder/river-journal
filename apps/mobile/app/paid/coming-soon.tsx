/**
 * Paid tier coming-soon stub route for Expo Router.
 * STUB destination — Story 7.4 wires the real PaidTierPurchaseSurface.
 */

import { useRouter } from 'solito/navigation'
import { View, Text } from 'react-native'
import { Pressable } from 'react-native'

export default function PaidComingSoonRoute() {
  const router = useRouter()

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <Text>Paid tier coming soon</Text>
      <Pressable onPress={() => router.back()}>
        <Text>Back</Text>
      </Pressable>
    </View>
  )
}
