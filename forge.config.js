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
    // Ignore development files and directories
    ignore: [
      // Development source files — anchor to root so we don't strip
      // src/ inside node_modules (e.g. node_modules/debug/src/ is runtime code)
      '^/src($|/)',
      '^/public($|/)',
      
      // Development dependencies and build-time-only native modules
      '/node_modules/(@testing-library|jest|eslint|babel).*($|/)',
      '/node_modules/@parcel/watcher($|/)',
      
      // Development configuration files
      '\\.gitignore',
      '\\.github($|/)',
      '\\.vscode($|/)',
      
      // Source maps and other development artifacts
      '\\.map$',
      
      // Debug-only assets
      'build/assets/test-tone\\.mp3',
      
      // Test files
      'test($|/)',
      'tests($|/)',
      '__tests__($|/)',
      '\\.(spec|test)\\.(js|ts|jsx|tsx)$',
      
      // Documentation
      'README\\.md',
      'CHANGELOG\\.md',
      'LICENSE',
      'docs($|/)',
      
      // Build process files
      'webpack\\.config\\.js',
      'babel\\.config\\.js',
      'tsconfig\\.json',
      
      // Temporary files
      'tmp($|/)',
      'temp($|/)',
      
      // Logs
      'logs($|/)',
      '\\.(log|logs)$'
    ],
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
        description: 'Live speech translation application using OpenAI and Google Gemini APIs',
        setupIcon: 'assets/icon.ico',
        iconUrl: 'https://raw.githubusercontent.com/kizuna-ai-lab/sokuji/main/assets/icon.ico',
        noMsi: true
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          categories: ['Audio'],
          icon: 'assets/icon.png',
          name: 'sokuji',
          productName: 'Sokuji',
          bin: 'sokuji'
        }
      },
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
