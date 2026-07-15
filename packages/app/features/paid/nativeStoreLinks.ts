/**
 * nativeStoreLinks — the pure provider → native store deep-link mapping used by
 * the Apple/Play cancel leg.
 *
 * Kept `Linking`-free so the mapping is independently testable without touching
 * the deferred cross-platform Linking idiom — the dialog consumes this seam and
 * opens the resolved URL through `react-native`'s Linking at press time.
 */

export interface NativeStoreLink {
  url: string
  label: string
  storeName: string
}

export function resolveNativeStoreLink(provider: 'apple_iap' | 'play_iap'): NativeStoreLink {
  if (provider === 'apple_iap') {
    return {
      url: 'https://apps.apple.com/account/subscriptions',
      label: 'Open App Store',
      storeName: 'App Store',
    }
  }
  return {
    url: 'https://play.google.com/store/account/subscriptions',
    label: 'Open Play Store',
    storeName: 'Play Store',
  }
}
