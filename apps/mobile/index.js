import 'setimmediate'

if (!global?.setImmediate) {
  global.setImmediate = setTimeout
}

import './crypto-polyfill'
import 'expo-router/entry'
