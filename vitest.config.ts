import { createRequire } from 'node:module'
import path from 'node:path'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The node_modules Node actually resolves against. From the main checkout that
// is ./node_modules; from a worktree under .claude/worktrees/ it is the main
// checkout's, three directories up, which vite's default `server.fs.allow`
// (the workspace root) does not cover -- so every `?url` asset import there
// failed with "Denied ID .../node_modules/..." and a dozen test files were
// unrunnable from a worktree.
const require = createRequire(import.meta.url)
const nodeModulesInUse = path.resolve(path.dirname(require.resolve('vite/package.json')), '..')

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), nodeModulesInUse],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: true,
    // .claude/ holds gitignored worktree checkouts whose stale test copies
    // would otherwise be collected alongside the real suite. native/build/
    // is the same shape: a gitignored tree, but of the FETCHED UPSTREAMS --
    // building the native lane leaves transcribe.cpp's own node-binding
    // tests at native/build/<lane>/_deps/transcribe-src/bindings/typescript/,
    // and vitest collected all 78 of them and failed every one (they need a
    // node runtime and a built .node addon, not jsdom). A real file-level
    // failure had 78 fake ones to hide among.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/native/build/**'],
  },
})