module.exports = (api) => {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
    plugins: [
      [
        require.resolve('babel-plugin-module-resolver'),
        {
          root: ['../..'],
          alias: {
            // define aliases to shorten the import paths
            app: '../../packages/app',
            // No alias for '@my/ui': Metro resolves it through the workspace link, and
            // the Tamagui compiler only recognizes components imported by package name.
            // A relative path here hides every @my/ui element from it.
          },
          extensions: ['.js', '.jsx', '.tsx', '.ios.js', '.android.js'],
        },
      ],
      'react-native-reanimated/plugin',
    ],
  }
}
