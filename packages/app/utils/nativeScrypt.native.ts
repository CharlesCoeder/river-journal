import QuickCrypto from 'react-native-quick-crypto'

const KEY_BYTES = 32
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

/**
 * React Native native scrypt via react-native-quick-crypto (OpenSSL/BoringSSL).
 * Metro bundler picks this file (.native.ts) on iOS/Android.
 */
export async function tryNativeScrypt(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array | null> {
  try {
    // Async scrypt avoids blocking the React Native JS thread during the expensive N=2^17 computation.
    if (typeof QuickCrypto.scrypt === 'function') {
      return new Promise<Uint8Array | null>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(QuickCrypto.scrypt as any)(
          password,
          salt,
          KEY_BYTES,
          SCRYPT_PARAMS,
          (err: unknown, derivedKey: ArrayBufferLike | null | undefined) => {
            if (err || !derivedKey) {
              resolve(null)
              return
            }
            resolve(new Uint8Array(derivedKey))
          }
        )
      })
    }

    // scryptSync is intentionally NOT used here: calling it with N=2^17 would block the JS thread
    // for ~200ms and freeze the UI. If the async API is unavailable (unexpected API change in a
    // future react-native-quick-crypto release), return null so the caller falls back to
    // @noble/hashes scryptAsync instead of silently hanging the thread.
    // eslint-disable-next-line no-console
    console.warn(
      '[nativeScrypt] react-native-quick-crypto async scrypt API not found; falling back to JS scryptAsync.'
    )
    return null
  } catch {
    return null
  }
}

