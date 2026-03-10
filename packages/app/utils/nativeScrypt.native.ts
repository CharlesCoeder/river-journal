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
    // Prefer async scrypt to avoid blocking the JS thread
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

    // Fall back to sync variant
    if (typeof QuickCrypto.scryptSync === 'function') {
      const key = QuickCrypto.scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS)
      return new Uint8Array(key)
    }

    return null
  } catch {
    return null
  }
}

