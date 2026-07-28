const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
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
      '.web.tsx',
      '.web.ts',
      '.web.js',
      '.web.jsx',
      '.tsx',
      '.ts',
      '.js',
      '.jsx',
      '.json',
    ],
  },
  experimental: {
    scrollRestoration: true,
  },
}

// Wrap with Sentry. Desktop is a static export (no Next server runtime), so
// only browser-side instrumentation + client source-map upload apply here;
// Rust-side crashes are captured by the `sentry` crate in src-tauri. Build-time
// secrets (org/project/authToken) must NEVER carry a NEXT_PUBLIC_ prefix.
// Source-map upload is skipped unless SENTRY_AUTH_TOKEN is present, so local
// desktop builds stay offline and quiet.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: true,
  telemetry: false,
})
