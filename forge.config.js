const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: ['assets', 'resources'],
    icon: process.platform === 'win32' ? 'assets/icon.ico' : 'assets/icon',
    appId: 'com.kizunaai.sokuji',
    executableName: 'sokuji',
    name: 'Sokuji',
    // Whitelist-based ignore: only include package.json, dist-electron/,
    // build/ (minus wasm/), and node_modules/ (pruned by Forge).
    // Everything else (src/, public/, model-packs/, extension/, etc.) is excluded.
    ignore: (filePath) => {
      // Root is always included
      if (filePath === '') return false;

      // Allow runtime-essential top-level entries
      if (filePath === '/package.json') return false;
      if (filePath.startsWith('/dist-electron')) return false;
      if (filePath.startsWith('/node_modules')) {
        // Strip dev-only junk inside node_modules
        if (/\/((@testing-library|jest|eslint|babel)[^/]*|@parcel\/watcher)(\/|$)/.test(filePath)) return true;
        if (/\.(map|ts|flow|markdown)$/.test(filePath)) return true;
        return false;
      }
      if (filePath.startsWith('/build')) {
        // WASM runtime dirs are INCLUDED (workers need importScripts / wasmPaths):
        //   sherpa-onnx-asr, sherpa-onnx-asr-stream, sherpa-onnx-tts, ort, vad, piper-plus
        // Model data dirs are EXCLUDED (downloaded at runtime via CDN + IndexedDB):
        //   sherpa-onnx-asr-sensevoice, opus-mt-*, sherpa-onnx-tts-piper-*, etc.
        if (filePath.startsWith('/build/wasm')) {
          // Must include the /build/wasm directory itself so its children are traversed
          if (filePath === '/build/wasm') return false;
          const wasmRuntimeDirs = [
            '/build/wasm/sherpa-onnx-asr',
            '/build/wasm/sherpa-onnx-asr-stream',
            '/build/wasm/sherpa-onnx-tts',
            '/build/wasm/ort',
            '/build/wasm/vad',
            '/build/wasm/piper-plus',
            '/build/wasm/gtcrn',
          ];
          // Keep runtime dirs and their contents, exclude everything else
          if (wasmRuntimeDirs.some(dir => filePath === dir || filePath.startsWith(dir + '/'))) return false;
          return true;
        }
        // Exclude source maps
        if (filePath.endsWith('.map')) return true;
        // Exclude debug assets
        if (filePath === '/build/assets/test-tone.mp3') return true;
        return false;
      }

      // Reject everything else
      return true;
    },
    // Only include necessary files
    prune: true,
    // Reduce executable size by removing debug symbols
    derefSymlinks: true,
    // Overwrite files if they already exist
    overwrite: true
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Sokuji',
        authors: 'Kizuna AI Lab',
        exe: 'sokuji.exe',
        description: 'AI-powered live speech translation application',
        setupIcon: 'assets/icon.ico',
        iconUrl: 'https://raw.githubusercontent.com/kizuna-ai-lab/sokuji/main/assets/icon.ico',
        noMsi: true
      }
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Sokuji',
        overwrite: true
      }
    }
    // PKG Installer removed - use npm run make:pkg for unsigned PKG builds
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  // Add hooks to further optimize the build
  hooks: {
    packageAfterPrune: async (forgeConfig, buildPath) => {
      const fs = require('fs');
      const path = require('path');
      
      // List of directories to check and remove unnecessary files
      const dirsToClean = [
        path.join(buildPath, 'node_modules')
      ];
      
      // Extensions and patterns of files to remove
      const patternsToRemove = [
        '.md', '.markdown', '.ts', '.map', '.flow', '.jst', 
        'LICENSE', 'license', 'LICENCE', 'licence',
        'CONTRIBUTING', 'HISTORY', 'CHANGELOG', 
        '.travis.yml', '.github', '.eslintrc', '.editorconfig',
        'Makefile', '.npmignore', '.gitignore', '.gitattributes',
        'example', 'examples', 'test', 'tests', '__tests__', 
        'coverage', '.nyc_output', '.vscode', '.idea'
      ];
      
      console.info('Cleaning unnecessary files from node_modules...');
      
      // Function to recursively remove unnecessary files
      const cleanDir = (dirPath) => {
        if (!fs.existsSync(dirPath)) return;
        
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            // Skip essential directories
            if (entry.name === 'node_modules' || entry.name === 'bin') {
              cleanDir(fullPath);
              continue;
            }
            
            // Check if directory name matches patterns to remove
            if (patternsToRemove.some(pattern => 
              entry.name === pattern || 
              entry.name.endsWith(pattern)
            )) {
              try {
                fs.rmSync(fullPath, { recursive: true, force: true });
                console.debug(`Removed directory: ${fullPath}`);
              } catch (err) {
                console.error(`Error removing ${fullPath}:`, err);
              }
            } else {
              cleanDir(fullPath);
            }
          } else if (entry.isFile()) {
            // Check if file matches patterns to remove
            if (patternsToRemove.some(pattern => 
              entry.name === pattern || 
              entry.name.endsWith(pattern)
            )) {
              try {
                fs.unlinkSync(fullPath);
                console.debug(`Removed file: ${fullPath}`);
              } catch (err) {
                console.error(`Error removing ${fullPath}:`, err);
              }
            }
          }
        }
      };
      
      // Clean each directory
      for (const dir of dirsToClean) {
        cleanDir(dir);
      }
      
      // Remove src/ directories from node_modules packages, but only when
      // the package's "main" entry does NOT reference src/ (some packages
      // like "debug" use src/ for runtime code)
      const nmDir = path.join(buildPath, 'node_modules');
      const removeSrcDirs = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('@')) {
            // Scoped package — recurse one level deeper
            removeSrcDirs(fullPath);
            continue;
          }
          const srcDir = path.join(fullPath, 'src');
          if (!fs.existsSync(srcDir)) continue;
          // Check if this package's main entry references src/
          try {
            const pkgJson = JSON.parse(fs.readFileSync(path.join(fullPath, 'package.json'), 'utf8'));
            const main = pkgJson.main || 'index.js';
            if (!main.includes('src/') && !main.includes('src\\')) {
              fs.rmSync(srcDir, { recursive: true, force: true });
              console.debug(`Removed src/ from: ${entry.name}`);
            }
          } catch {
            // No package.json — skip
          }
        }
      };
      removeSrcDirs(nmDir);

      console.info('Finished cleaning unnecessary files.');
    }
  }
};
