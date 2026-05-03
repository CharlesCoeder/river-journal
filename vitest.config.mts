import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Redirect react-native to react-native-web for Node.js test environments.
      // This prevents the react-native/index.js Flow-type annotation
      // (`import typeof`) from crashing Rollup's standard JS parser during SSR
      // module loading in Vitest.
      'react-native': path.resolve(
        import.meta.dirname,
        'node_modules/react-native-web/dist/cjs/index.js'
      ),
      // Stub out native-only packages that have no Node.js-compatible build.
      'react-native-reanimated': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/react-native-reanimated.ts'
      ),
      'react-native-gesture-handler': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/react-native-gesture-handler.ts'
      ),
      'solito/navigation': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/solito-navigation.ts'
      ),
      '@my/ui': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/my-ui.ts'
      ),
    },
  },
  test: {
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    env: {
      // Stubs so modules that eagerly construct a Supabase client at
      // import time don't throw in test environments. Tests that exercise
      // real Supabase flows mock the client explicitly.
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
