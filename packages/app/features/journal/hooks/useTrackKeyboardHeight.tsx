import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { runOnJS } from 'react-native-reanimated'
import { ephemeral$ } from 'app/state/store'

const setKeyboardHeight = (height: number) => {
  const rounded = Math.round(height)
  if (ephemeral$.keyboardHeight.peek() !== rounded) {
    ephemeral$.keyboardHeight.set(rounded)
  }
}

/**
 * Stores final keyboard height in ephemeral$ so PersistentEditor can
 * adjust its bottom inset. Uses onEnd (not onMove) since the editor
 * content area only needs the settled value — the bottom bar handles
 * its own per-frame animation via KeyboardOffsetView.
 */
export function useTrackKeyboardHeight() {
  useKeyboardHandler(
    {
      onEnd: (e) => {
        'worklet'
        runOnJS(setKeyboardHeight)(e.height)
      },
    },
    []
  )
}
