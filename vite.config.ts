import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // For Electron builds, alias clerk to use clerk-react
      '@clerk/chrome-extension': '@clerk/clerk-react'
    }
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'build',
    assetsDir: 'static',
    sourcemap: true
  },
  base: './',
  define: {
    global: 'globalThis',
    // Define build target for Electron
    'import.meta.env.BUILD_TARGET': JSON.stringify('electron')
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["legacy-js-api"],
      }
    }
  },
  optimizeDeps: {
    exclude: ['electron']
  }
}) 