/** @type {import('next').NextConfig} */
module.exports = {
  // Security headers for every route. CSP is deliberately absent for now —
  // a workable policy needs an inventory of inline styles/scripts (Tamagui
  // injects inline styles) and the Supabase origins, so it ships separately.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
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
