import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import fs from 'fs'

/**
 * Dev-only plugin: serve model-packs/tts/ files at /model-packs/tts/ URLs.
 * TTS model .data and package-metadata.json files live in model-packs/tts/wasm-*
 * and need to be accessible to the browser during development.
 */
function serveModelPacks(): Plugin {
  return {
    name: 'serve-model-packs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/model-packs/tts/')) return next()
        const filePath = path.join(process.cwd(), decodeURIComponent(req.url))
        if (!fs.existsSync(filePath)) return next()
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return next()
        res.setHeader('Content-Length', stat.size)
        if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
        else res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * Dev-only plugin: serve ORT WASM files from node_modules/onnxruntime-web/dist/
 * at /wasm/ort/ URLs, bypassing Vite's module transform pipeline which rejects
 * dynamic imports of .mjs files from public/.
 */
function serveOrtWasm(): Plugin {
  return {
    name: 'serve-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/wasm/ort/')) return next()
        const filename = decodeURIComponent(req.url.replace('/wasm/ort/', '').replace(/\?.*$/, ''))
        const filePath = path.join(process.cwd(), 'node_modules/onnxruntime-web/dist', filename)
        if (!fs.existsSync(filePath)) return next()
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return next()
        res.setHeader('Content-Length', stat.size)
        if (filePath.endsWith('.mjs') || filePath.endsWith('.js'))
          res.setHeader('Content-Type', 'application/javascript')
        else if (filePath.endsWith('.wasm'))
          res.setHeader('Content-Type', 'application/wasm')
        else
          res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory
  const env = loadEnv(mode, process.cwd(), '')
  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG
  
  return {
    plugins: [
      isServe && serveModelPacks(),
      isServe && serveOrtWasm(),
      react(),
      electron({
        main: {
          // Entry points for the main process
          entry: {
            'better-auth-adapter': 'electron/better-auth-adapter.js',
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
    ],
    server: {
      port: 5173,
      host: true,
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
        scss: {}
      }
    },
    optimizeDeps: {
      exclude: ['electron']
    }
  }
}) 