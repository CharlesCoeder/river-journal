/** @type {import('next').NextConfig} */
const { baseConfig, plugins } = require('./next.config.base')

module.exports = () => {
  const buildTarget = process.env.BUILD_TARGET || 'web'

  let config = {
    ...baseConfig,
  }

  // Platform-specific configurations
  if (buildTarget === 'tauri') {
    config = {
      ...config,
      output: 'export',
      trailingSlash: true,
      images: {
        unoptimized: true,
      },
      // Disable features that don't work with static export
      experimental: {
        ...config.experimental,
        // Remove features that require server
      },
    }
  } else {
    // Web-specific configuration
    config = {
      ...config,
      // Keep all SSR/SSG capabilities for web
    }
  }

  // Apply plugins
  for (const plugin of plugins) {
    config = {
      ...config,
      ...plugin(config),
    }
  }

  return config
}
