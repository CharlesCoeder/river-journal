const IS_DEV = process.env.APP_VARIANT === 'development'
const IS_PREVIEW = process.env.APP_VARIANT === 'preview'

const getUniqueIdentifier = () => {
  if (IS_DEV) return 'com.charlescoeder.riverjournal.dev'
  if (IS_PREVIEW) return 'com.charlescoeder.riverjournal.preview'
  return 'com.charlescoeder.riverjournal'
}

const getAndroidPackage = () => {
  if (IS_DEV) return 'com.river_journal.app.dev'
  if (IS_PREVIEW) return 'com.river_journal.app.preview'
  return 'com.river_journal.app'
}

const getAppName = () => {
  if (IS_DEV) return 'River Journal (Dev)'
  if (IS_PREVIEW) return 'River Journal (Preview)'
  return 'river-journal'
}

// Dev/preview use their bundle identifier as the URL scheme. Expo already
// registers the bundle identifier as a scheme in every native build, so
// `expo start` and OAuth redirects can target a dev build — including ones
// built before this scheme was set — without a rebuild. It also can't collide
// with the production scheme, which is what lets both apps live on one phone.
const getScheme = () => {
  if (IS_DEV) return getUniqueIdentifier()
  if (IS_PREVIEW) return getUniqueIdentifier()
  return 'river-journal'
}

module.exports = {
  expo: {
    name: getAppName(),
    slug: 'river-journal',
    scheme: getScheme(),
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    // EAS Update. `runtimeVersion` uses the appVersion policy: every build with
    // the same `version` shares a runtime, so JS-only changes ship with
    // `yarn update:prod` and are picked up on the next cold launch. Anything
    // that changes native code (new native module, plugin/config change,
    // SDK bump) needs a version bump *and* a new `eas build`, otherwise the
    // update would be delivered to a binary that can't run it.
    updates: {
      url: 'https://u.expo.dev/67d505a1-7f11-4db3-bffd-0a58015f5fcd',
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: getUniqueIdentifier(),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
      buildNumber: '2',
      privacyManifests: {
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
      package: getAndroidPackage(),
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-web-browser',
      'expo-notifications',
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Use Face ID to unlock your journal with App Lock.',
        },
      ],
      'expo-document-picker',
      '@sentry/react-native/expo',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: '67d505a1-7f11-4db3-bffd-0a58015f5fcd',
      },
    },
  },
}
