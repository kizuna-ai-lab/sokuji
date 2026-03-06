import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory
  const env = loadEnv(mode, process.cwd(), '')
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  const buildTarget = (process.env.EBURON_BUILD_TARGET || env.EBURON_BUILD_TARGET || env.VITE_BUILD_TARGET || 'web').toLowerCase()
  const isElectronTarget = buildTarget === 'electron'
  
  return {
    plugins: [
      react(),
      ...(isElectronTarget ? [
        electron({
          main: {
            // Entry points for the main process
            entry: {
              'macos-audio-utils': 'electron/macos-audio-utils.js',
              'main': 'electron/main.js',
              'pulseaudio-utils': 'electron/pulseaudio-utils.js',
              'windows-audio-utils': 'electron/windows-audio-utils.js',
              'vb-cable-installer': 'electron/vb-cable-installer.js',
              'squirrel-events': 'electron/squirrel-events.js'
            },
            onstart(args) {
              // Override default [".", "--no-sandbox"] to fix DevTools crash on Linux
              args.startup(["."])
            },
            vite: {
              build: {
                sourcemap,
                minify: isBuild,
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron', 'electron-squirrel-startup', 'electron-conf', 'electron-audio-loopback'],
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
      ] : [])
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
    base: isElectronTarget ? './' : '/',
    define: {
      global: 'globalThis',
      'import.meta.env.BUILD_TARGET': JSON.stringify(buildTarget)
    },
    css: {
      preprocessorOptions: {
        scss: {}
      }
    },
    optimizeDeps: {
      exclude: isElectronTarget ? ['electron'] : []
    }
  }
}) 