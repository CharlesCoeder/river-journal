const __ReactNativeStyleSheet = require('react-native').StyleSheet;
const _sheet = __ReactNativeStyleSheet.create({
  "0": {
    "flexDirection": "column",
    "borderTopLeftRadius": 12,
    "borderTopRightRadius": 12,
    "borderBottomRightRadius": 12,
    "borderBottomLeftRadius": 12,
    "borderTopWidth": 1,
    "borderRightWidth": 1,
    "borderBottomWidth": 1,
    "borderLeftWidth": 1,
    "paddingTop": 13,
    "paddingRight": 13,
    "paddingBottom": 13,
    "paddingLeft": 13,
    "borderStyle": "solid"
  }
});
import { _withStableStyle } from '@tamagui/core';
const __ReactNativeView = require('react-native').View;
const __ReactNativeText = require('react-native').Text;
import { YStack } from '@my/ui';
import ColorPicker, { Panel1, HueSlider } from 'reanimated-color-picker';
import { StyleSheet } from 'react-native';
export function InlineColorPicker({
  color,
  onChange
}: {
  color: string;
  onChange: (hex: string) => void;
}) {
  return <_ReactNativeViewStyled0>
      <ColorPicker value={color} onCompleteJS={({
      hex
    }) => onChange(hex)} style={styles.picker}>
        <Panel1 style={styles.panel} />
        <HueSlider style={styles.slider} />
      </ColorPicker>
    </_ReactNativeViewStyled0>;
}
const styles = StyleSheet.create({
  picker: {
    gap: 12
  },
  panel: {
    height: 180,
    borderRadius: 8
  },
  slider: {
    height: 28,
    borderRadius: 8
  }
});
const _ReactNativeViewStyled0 = _withStableStyle(__ReactNativeView, (theme, _expressions) => [_sheet["0"], {
  "borderTopColor": theme.color5.get(),
  "borderRightColor": theme.color5.get(),
  "borderBottomColor": theme.color5.get(),
  "borderLeftColor": theme.color5.get()
}]);