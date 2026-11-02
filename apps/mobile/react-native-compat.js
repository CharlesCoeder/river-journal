// Tamagui 3 reads usePressability from the react-native root, which React Native
// only exports from 0.84. This app is on 0.81 through Expo 54, so expose the copy
// that already ships inside React Native. Delete this file after upgrading to
// React Native 0.84 or newer.
const ReactNative = require('react-native')

if (!('usePressability' in ReactNative)) {
  Object.defineProperty(ReactNative, 'usePressability', {
    configurable: true,
    get() {
      return require('react-native/Libraries/Pressability/usePressability').default
    },
  })
}
