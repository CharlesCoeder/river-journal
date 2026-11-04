// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ephemeral$ } from '../../../state/store'
import { useAppLockBlurRequest } from '../useAppLockBlurRequest'

describe('useAppLockBlurRequest', () => {
  beforeEach(() => {
    ephemeral$.isLocked.set(false)
  })

  it('changes each time App Lock engages and not when it releases', () => {
    const { result } = renderHook(() => useAppLockBlurRequest())
    const atMount = result.current

    act(() => ephemeral$.isLocked.set(true))
    const firstLock = result.current
    expect(firstLock).not.toBe(atMount)

    act(() => ephemeral$.isLocked.set(false))
    expect(result.current).toBe(firstLock)

    act(() => ephemeral$.isLocked.set(true))
    expect(result.current).not.toBe(firstLock)
  })
})
