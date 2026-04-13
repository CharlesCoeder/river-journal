import { Text, YStack, isWeb } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, setFontPairing } from 'app/state/store'
import { DEFAULT_FONT_PAIRING } from 'app/state/types'
import type { FontPairingId } from 'app/state/types'

const FONT_PAIRINGS: {
  id: FontPairingId
  uiFont: string
  uiLabel: string
  contentFont: string
  contentLabel: string
}[] = [
  {
    id: 'outfit-newsreader',
    uiFont: 'Outfit',
    uiLabel: 'Outfit',
    contentFont: 'Newsreader',
    contentLabel: 'Newsreader',
  },
  {
    id: 'lato-lora',
    uiFont: 'Lato',
    uiLabel: 'Lato',
    contentFont: 'Lora',
    contentLabel: 'Lora',
  },
  {
    id: 'inter-source-serif',
    uiFont: 'Inter',
    uiLabel: 'Inter',
    contentFont: 'SourceSerif4',
    contentLabel: 'Source Serif 4',
  },
]

function FontPairingRow({
  pairing,
  isSelected,
  onSelect,
}: {
  pairing: (typeof FONT_PAIRINGS)[number]
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <YStack
      testID={`font-pairing-${pairing.id}${isSelected ? '-selected' : ''}`}
      gap="$1"
      cursor="pointer"
      onPress={onSelect}
      paddingVertical="$1"
      transition="designEnter"
      enterStyle={{ opacity: 0, y: 10 }}
      opacity={1}
      y={0}
      hoverStyle={{ opacity: 0.8 }}
      pressStyle={{ opacity: 0.7 }}
    >
      <Text
        fontFamily={pairing.uiFont}
        fontSize={20}
        color={isSelected ? '$color' : '$color8'}
        {...(isWeb && { hoverStyle: { color: '$color' } })}
      >
        {pairing.uiLabel}
      </Text>
      <Text
        fontFamily={pairing.contentFont}
        fontSize={20}
        color={isSelected ? '$color' : '$color8'}
        {...(isWeb && { hoverStyle: { color: '$color' } })}
      >
        {pairing.contentLabel}
      </Text>
    </YStack>
  )
}

export function FontPicker() {
  const currentPairing = use$(store$.profile.fontPairing) ?? DEFAULT_FONT_PAIRING

  return (
    <YStack gap="$3">
      {FONT_PAIRINGS.map((pairing) => (
        <FontPairingRow
          key={pairing.id}
          pairing={pairing}
          isSelected={currentPairing === pairing.id}
          onSelect={() => setFontPairing(pairing.id)}
        />
      ))}
    </YStack>
  )
}
