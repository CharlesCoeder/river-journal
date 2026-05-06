/**
 * Stub for @react-native-community/netinfo for Node.js test environments.
 * The real package ships ESM-in-CJS that Vitest cannot resolve. Tests that
 * exercise online-tracking behavior should mock this module explicitly.
 */

type Listener = (state: { isConnected: boolean | null }) => void

const NetInfo = {
  addEventListener: (_listener: Listener) => {
    return () => {}
  },
  fetch: async () => ({ isConnected: true }),
}

export default NetInfo
