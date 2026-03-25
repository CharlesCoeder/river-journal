/** @type {import('next').NextConfig} */
module.exports = {
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_IS_DESKTOP_APP: 'true',
  },
  // Enable static export for Tauri
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    'solito',
    'react-native-web',
    'expo-linking',
    'expo-constants',
    'expo-modules-core',
    '@tamagui/react-native-svg',
    '@tamagui/next-theme',
    '@tamagui/lucide-icons',
  ],
  turbopack: {
    resolveAlias: {
      'react-native': 'react-native-web',
      'react-native-svg': '@tamagui/react-native-svg',
      'react-native-safe-area-context': './shims/react-native-safe-area-context.js',
    },
    resolveExtensions: [
      '.web.tsx', '.web.ts', '.web.js', '.web.jsx',
      '.tsx', '.ts', '.js', '.jsx', '.json',
    ],
  },
  experimental: {
    scrollRestoration: true,
  },
}
