import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: true,
    // .claude/ holds gitignored worktree checkouts whose stale test copies
    // would otherwise be collected alongside the real suite.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})