/**
 * useAppLockBlurRequest — a counter that changes each time App Lock engages.
 *
 * Pass it to an editor's `blurRequest` prop so the editor drops focus (and the
 * soft keyboard) when the lock screen goes up. The overlay covers the editor
 * but not the keyboard, so a focused editor would otherwise keep taking
 * keystrokes behind the lock screen.
 */

import { useEffect, useState } from 'react'
import { use$ } from '@legendapp/state/react'
import { ephemeral$ } from '../../state/store'

export function useAppLockBlurRequest(): number {
  const isLocked = use$(ephemeral$.isLocked)
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (isLocked) setCount((n) => n + 1)
  }, [isLocked])
  return count
}
