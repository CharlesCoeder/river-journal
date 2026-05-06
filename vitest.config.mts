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
      // Stub out @tamagui/lucide-icons which transitively requires react-native-svg
      // (a native-only package with no Node.js-compatible build).
      '@tamagui/lucide-icons': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/tamagui-lucide-icons.ts'
      ),
      // Stub out react-native-svg which is a native-only package with no
      // Node.js-compatible build (transitively required by @tamagui/lucide-icons).
      'react-native-svg': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/react-native-svg.ts'
      ),
      // Stub out @react-native-community/netinfo which is a native-only
      // package; Node tests that touch the native query client only need a
      // no-op event-listener surface.
      '@react-native-community/netinfo': path.resolve(
        import.meta.dirname,
        'packages/app/features/navigation/__mocks__/netinfo.ts'
      ),
      // Map the 'app/*' workspace alias (used in source imports) to the
      // actual package directory so Vitest can resolve it in test environments.
      app: path.resolve(import.meta.dirname, 'packages/app'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // Exclude default deps + git worktrees (kept under .claude/worktrees/ for sprint
    // recovery). Without this, vitest's glob walks into worktree copies of the repo
    // and runs duplicate test files against worktree-local node_modules.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/worktrees/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
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
