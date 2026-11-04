// packages/app/utils/encryption.ts requires expo-crypto for a React Native
// fallback that never runs in a browser, which has globalThis.crypto. Turbopack
// still follows the require, and expo-crypto imports the `expo` package, which
// Next cannot compile from node_modules.
module.exports = {}
