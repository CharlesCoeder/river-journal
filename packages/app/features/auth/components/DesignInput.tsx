/**
 * DesignInput — bottom-border-only serif input matching the design reference.
 * Wraps Tamagui Input with design-system styling.
 */

import { XStack, Input, Text, isWeb } from '@my/ui'

interface DesignInputProps {
  value: string
  onChangeText: (v: string) => void
  onBlur?: () => void
  placeholder: string
  secureTextEntry?: boolean
  disabled?: boolean
  showToggle?: boolean
  onToggleShow?: () => void
  autoComplete?: string
  onSubmitEditing?: () => void
  keyboardType?: 'default' | 'email-address'
}

export function DesignInput({
  value,
  onChangeText,
  onBlur,
  placeholder,
  secureTextEntry,
  disabled,
  showToggle,
  onToggleShow,
  autoComplete,
  onSubmitEditing,
  keyboardType,
}: DesignInputProps) {
  return (
    <XStack
      width="100%"
      alignItems="center"
    >
      <Input
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        disabled={disabled}
        autoCapitalize="none"
        autoComplete={autoComplete as any}
        keyboardType={keyboardType}
        onSubmitEditing={onSubmitEditing}
        // On web, secureTextEntry doesn't always produce type="password".
        // Explicitly set it so the browser masks input and respects password manager autofill.
        {...(isWeb && secureTextEntry ? { type: 'password' } as any : {})}
        {...(isWeb && keyboardType === 'email-address' ? { type: 'email' } as any : {})}
        flex={1}
        fontFamily="$journal"
        fontSize={20}
        color="$color"
        placeholderTextColor="$color6"
        backgroundColor="transparent"
        borderWidth={0}
        borderBottomWidth={1}
        borderColor="$color3"
        borderRadius={0}
        paddingHorizontal={0}
        paddingVertical="$2"
        focusStyle={{
          borderColor: '$color',
          borderWidth: 0,
          borderBottomWidth: 1,
          outlineWidth: 0,
          outlineStyle: 'none' as any,
        }}
        hoverStyle={{
          borderWidth: 0,
          borderBottomWidth: 1,
          borderColor: '$color5',
        }}
      />
      {showToggle && onToggleShow && (
        <Text
          fontFamily="$body"
          fontSize={10}
          letterSpacing={3}
          textTransform="uppercase"
          color="$color8"
          cursor="pointer"
          hoverStyle={{ color: '$color' }}
          onPress={onToggleShow}
          marginLeft="$2"
          flexShrink={0}
        >
          {secureTextEntry ? 'Show' : 'Hide'}
        </Text>
      )}
    </XStack>
  )
}
