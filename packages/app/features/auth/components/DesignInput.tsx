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
        {...(isWeb && secureTextEntry ? ({ type: 'password' } as any) : {})}
        {...(isWeb && keyboardType === 'email-address' ? ({ type: 'email' } as any) : {})}
        flex={1}
        fontFamily="journal"
        fontSize={20}
        color="color"
        placeholderTextColor="color6"
        backgroundColor="transparent"
        borderTopWidth="0px hover:0px focus:0px"
        borderRightWidth="0px hover:0px focus:0px"
        borderLeftWidth="0px hover:0px focus:0px"
        borderBottomWidth="1px hover:1px focus:1px"
        borderColor="color3 hover:color5 focus:color"
        borderRadius={0}
        paddingHorizontal={0}
        paddingVertical="2"
        outlineWidth="focus:0px"
        outlineStyle="focus:none"
      />
      {showToggle && onToggleShow && (
        <Text
          fontFamily="body"
          fontSize={10}
          letterSpacing={3}
          textTransform="uppercase"
          color="color8 hover:color"
          cursor="pointer"
          marginLeft="2"
          flexShrink={0}
          onPress={onToggleShow}
        >
          {secureTextEntry ? 'Show' : 'Hide'}
        </Text>
      )}
    </XStack>
  )
}
