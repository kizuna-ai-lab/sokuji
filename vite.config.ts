import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory
  const env = loadEnv(mode, process.cwd(), '')
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  
  return {
    plugins: [
      react(),
      electron({
        main: {
          // Entry points for the main process
          entry: {
            'main': 'electron/main.js',
            'clerk-adapter': 'electron/clerk-adapter.js',
            'pulseaudio-utils': 'electron/pulseaudio-utils.js',
            'windows-audio-utils': 'electron/windows-audio-utils.js',
            'vb-cable-installer': 'electron/vb-cable-installer.js',
            'squirrel-events': 'electron/squirrel-events.js',
            'macos-audio-utils': 'electron/macos-audio-utils.js'
          },
          onstart(args) {
            args.startup()
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron', 'electron-squirrel-startup', 'electron-conf'],
                output: {
                  entryFileNames: '[name].js'
                }
              }
            },
            define: {
              'import.meta.env.MODE': JSON.stringify(mode)
            }
          }
        },
        preload: {
          // Entry point for the preload script
          input: 'electron/preload.js',
          vite: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron']
              }
            }
          }
        },
        // Polyfill the Electron and Node.js built-in modules for renderer process
        renderer: {}
      })
    ],
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
  }
}) 