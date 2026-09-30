import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Let `.tsx` tests use the automatic JSX runtime without a per-file pragma.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Keep vitest's defaults and additionally skip agent worktree copies and
    // throwaway prototypes, which otherwise duplicate the real test files.
    exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**', '.claude/**', 'prototypes/**'],
  },
});
