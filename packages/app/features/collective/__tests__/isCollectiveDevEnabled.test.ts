import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIVE_DEV_ROUTE, isCollectiveDevEnabled } from '../isCollectiveDevEnabled'

describe('isCollectiveDevEnabled', () => {
  const original = {
    next: process.env.NEXT_PUBLIC_COLLECTIVE_DEV,
    expo: process.env.EXPO_PUBLIC_COLLECTIVE_DEV,
  }

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_COLLECTIVE_DEV
    delete process.env.EXPO_PUBLIC_COLLECTIVE_DEV
  })

  afterEach(() => {
    if (original.next === undefined) delete process.env.NEXT_PUBLIC_COLLECTIVE_DEV
    else process.env.NEXT_PUBLIC_COLLECTIVE_DEV = original.next
    if (original.expo === undefined) delete process.env.EXPO_PUBLIC_COLLECTIVE_DEV
    else process.env.EXPO_PUBLIC_COLLECTIVE_DEV = original.expo
  })

  it('is disabled by default', () => {
    expect(isCollectiveDevEnabled()).toBe(false)
  })

  it('is enabled via NEXT_PUBLIC_COLLECTIVE_DEV (web/desktop)', () => {
    process.env.NEXT_PUBLIC_COLLECTIVE_DEV = 'true'
    expect(isCollectiveDevEnabled()).toBe(true)
  })

  it('is enabled via EXPO_PUBLIC_COLLECTIVE_DEV (mobile)', () => {
    process.env.EXPO_PUBLIC_COLLECTIVE_DEV = 'true'
    expect(isCollectiveDevEnabled()).toBe(true)
  })

  it('treats any value other than the string "true" as disabled', () => {
    process.env.NEXT_PUBLIC_COLLECTIVE_DEV = '1'
    expect(isCollectiveDevEnabled()).toBe(false)
  })

  it('exposes the always-available dev route', () => {
    expect(COLLECTIVE_DEV_ROUTE).toBe('/collective/dev')
  })
})
