import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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