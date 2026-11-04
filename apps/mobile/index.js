import 'setimmediate'

if (!global?.setImmediate) {
  global.setImmediate = setTimeout
}

import './crypto-polyfill'
import './react-native-compat'
import 'expo-router/entry'
