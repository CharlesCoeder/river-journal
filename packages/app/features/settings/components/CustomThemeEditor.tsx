import { useState, useMemo } from 'react'
import { Button, Circle, Input, Text, XStack, YStack, View } from '@my/ui'
import { use$ } from '@legendapp/state/react'
import { store$, setCustomTheme, clearCustomTheme } from 'app/state/store'
import { hexToRgb, THEME_DEFS } from '@my/config/src/themes'
import { DEFAULT_THEME } from 'app/state/types'
import type { ThemeName } from 'app/state/types'
import { ColorPickerSwatch } from './ColorPickerSwatch'
import { InlineColorPicker } from './InlineColorPicker'

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/

type ColorField = 'bg' | 'text' | 'stone'

const COLOR_LABELS: Record<ColorField, string> = {
  bg: 'Background',
  text: 'Text',
  stone: 'Stone',
}

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
  isActive,
  onChangeText,
  onSwatchPress,
}: {
  label: string
  value: string
  isActive: boolean
  onChangeText: (v: string) => void
  onSwatchPress: () => void
}) {
  const isValid = HEX_REGEX.test(value)

  return (
    <XStack
      alignItems="center"
      gap="$3"
    >
      <ColorPickerSwatch
        color={value}
        isValid={isValid}
        isActive={isActive}
        onPress={onSwatchPress}
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
  const [activeField, setActiveField] = useState<ColorField | null>(null)

  const colors: Record<ColorField, string> = { bg, text, stone }
  const setters: Record<ColorField, (v: string) => void> = { bg: setBg, text: setText, stone: setStone }

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

  const handleSwatchPress = (field: ColorField) => {
    setActiveField((prev) => (prev === field ? null : field))
  }

  return (
    <YStack
      gap="$4"
      paddingVertical="$3"
    >
      {(['bg', 'text', 'stone'] as const).map((field) => (
        <ColorInput
          key={field}
          label={COLOR_LABELS[field]}
          value={colors[field]}
          isActive={activeField === field}
          onChangeText={setters[field]}
          onSwatchPress={() => handleSwatchPress(field)}
        />
      ))}

      {/* Inline color picker — appears between inputs and preview */}
      {activeField && HEX_REGEX.test(colors[activeField]) && (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize={12} color="$color8">
            Editing {COLOR_LABELS[activeField].toLowerCase()}
          </Text>
          <InlineColorPicker
            color={colors[activeField]}
            onChange={setters[activeField]}
          />
        </YStack>
      )}

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

      {/* Contrast advisory — non-blocking, creation surface only */}
      {lowContrast && (
        <XStack testID="contrast-warning" alignItems="center" gap="$2">
          <Circle testID="contrast-warning-dot" size={6} backgroundColor="$color8" />
          <Text fontFamily="$body" fontSize={13} color="$color8" fontStyle="italic">
            This combination may be hard to read.
          </Text>
        </XStack>
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
          // disabled is bound ONLY to hex-format validity — low contrast is a non-blocking advisory (NFR26 + epics.md:1358); do NOT widen.
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
