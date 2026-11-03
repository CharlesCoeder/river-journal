// Web and desktop load react-native (react-native-web) lazily, so a flow that may
// never open a link does not pull it in statically.
export function loadLinking(): Promise<typeof import('react-native').Linking> {
  return import('react-native').then((rn) => rn.Linking)
}
