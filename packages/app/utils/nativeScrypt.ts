/**
 * Web/Desktop stub — native scrypt is not available outside React Native.
 * Tauri desktop uses its own Rust scrypt path directly in encryption.ts.
 */
export async function tryNativeScrypt(
  _password: string,
  _salt: Uint8Array
): Promise<Uint8Array | null> {
  return null
}
