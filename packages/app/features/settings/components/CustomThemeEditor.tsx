import { useState, useMemo } from 'react'
import { Button, Input, Text, XStack, YStack, View } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, setCustomTheme, clearCustomTheme } from 'app/state/store'
import { hexToRgb, THEME_DEFS } from '@my/config/src/themes'
import { DEFAULT_THEME } from 'app/state/types'
import type { ThemeName } from 'app/state/types'

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function ColorInput({
  label,
  value,
  onChangeText,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
}) {
  const isValid = HEX_REGEX.test(value)

  return (
    <XStack
      alignItems="center"
      gap="$3"
    >
      <View
        width={32}
        height={32}
        borderRadius={6}
        borderWidth={1}
        borderColor="$color5"
        backgroundColor={isValid ? value : '$background'}
      />
      <YStack
        flex={1}
        gap="$1"
      >
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$color8"
        >
          {label}
        </Text>
        <Input
          testID={`color-input-${label.toLowerCase()}`}
          value={value}
          onChangeText={onChangeText}
          placeholder="#F9F6F0"
          fontFamily="$body"
          fontSize={15}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect={false}
          borderColor={isValid || value.length === 0 ? '$color5' : '$red10'}
        />
      </YStack>
    </XStack>
  )
}

export function CustomThemeEditor({ onClose }: { onClose: () => void }) {
  const customTheme = use$(store$.profile.customTheme)
  const currentPreset = use$(store$.profile.themeName) ?? DEFAULT_THEME

  // Seed from existing custom theme, or fall back to the currently active preset's colors
  const seedDef =
    customTheme ?? THEME_DEFS[currentPreset as ThemeName] ?? THEME_DEFS[DEFAULT_THEME]!

  const [bg, setBg] = useState(seedDef.bg)
  const [text, setText] = useState(seedDef.text)
  const [stone, setStone] = useState(seedDef.stone)

  const allValid = HEX_REGEX.test(bg) && HEX_REGEX.test(text) && HEX_REGEX.test(stone)

  const contrast = useMemo(() => {
    if (!HEX_REGEX.test(bg) || !HEX_REGEX.test(text)) return null
    return contrastRatio(bg, text)
  }, [bg, text])

  const lowContrast = contrast !== null && contrast < 4.5

  const handleSave = () => {
    if (!allValid) return
    setCustomTheme({ bg, text, stone })
    onClose()
  }

  const handleDelete = () => {
    clearCustomTheme()
    onClose()
  }

  return (
    <YStack
      gap="$4"
      paddingVertical="$3"
    >
      <ColorInput
        label="Background"
        value={bg}
        onChangeText={setBg}
      />
      <ColorInput
        label="Text"
        value={text}
        onChangeText={setText}
      />
      <ColorInput
        label="Stone"
        value={stone}
        onChangeText={setStone}
      />

      {/* Live Preview */}
      {allValid && (
        <YStack
          testID="custom-theme-preview"
          borderRadius={12}
          padding="$4"
          gap="$3"
          backgroundColor={bg}
          borderWidth={1}
          borderColor={stone}
        >
          <Text
            fontFamily="$journal"
            fontSize={20}
            color={text}
          >
            The river flows quietly
          </Text>
          <Text
            fontFamily="$body"
            fontSize={14}
            color={stone}
          >
            A preview of muted text and labels
          </Text>
          <View
            height={1}
            backgroundColor={stone}
            opacity={0.4}
          />
          <Text
            fontFamily="$body"
            fontSize={12}
            color={stone}
          >
            Stone-colored separator above
          </Text>
        </YStack>
      )}

      {/* WCAG Contrast Warning */}
      {lowContrast && (
        <Text
          testID="contrast-warning"
          fontFamily="$body"
          fontSize={13}
          color="$orange10"
        >
          Low contrast ({contrast?.toFixed(1)}:1) — WCAG AA recommends at least 4.5:1 for
          readability
        </Text>
      )}

      <XStack
        gap="$3"
        justifyContent="flex-end"
      >
        {customTheme && (
          <Button
            testID="delete-custom-theme"
            size="$3"
            variant="outlined"
            onPress={handleDelete}
          >
            Delete
          </Button>
        )}
        <Button
          testID="cancel-custom-theme"
          size="$3"
          variant="outlined"
          onPress={onClose}
        >
          Cancel
        </Button>
        <Button
          testID="save-custom-theme"
          size="$3"
          disabled={!allValid}
          opacity={allValid ? 1 : 0.5}
          onPress={handleSave}
        >
          Save
        </Button>
      </XStack>
    </YStack>
  )
}
