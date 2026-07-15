const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
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

// Wrap with Sentry for build-time instrumentation + production source-map
// upload (de-minified crash reports). Org/project/auth are build-time-only
// secrets — they must NEVER carry a NEXT_PUBLIC_ prefix (that would leak the
// auth token into the client bundle). Upload is a no-op locally when
// SENTRY_AUTH_TOKEN is unset, so dev builds stay offline and quiet.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Skip source-map upload unless the build-time auth token is present.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Keep local/CI logs clean and do not phone home build metrics.
  silent: true,
  telemetry: false,
})
