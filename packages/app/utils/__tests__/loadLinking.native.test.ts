import { describe, expect, it, vi } from 'vitest'

const Linking = { openURL: vi.fn() }

vi.mock('react-native', () => ({
  get Linking() {
    return Linking
  },
  get PushNotificationIOS() {
    throw new Error('`new NativeEventEmitter()` requires a non-null argument.')
  },
}))

describe('loadLinking (native)', () => {
  it('resolves Linking without touching other React Native exports, one of which throws', async () => {
    const { loadLinking } = await import('../loadLinking.native')
    await expect(loadLinking()).resolves.toBe(Linking)
  })
})
