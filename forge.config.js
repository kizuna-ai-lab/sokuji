const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: ['assets'],
    icon: 'assets/icon',
    appId: 'com.kizunaai.sokuji',
    executableName: 'sokuji',
    name: 'Sokuji',
    // Ignore development files and directories
    ignore: [
      // Development source files (but keep the build directory)
      '/src($|/)',
      '/public($|/)',
      '!build($|/)',  // Explicitly include the build directory
      
      // Development dependencies
      '/node_modules/(@testing-library|jest|eslint|babel).*($|/)',
      
      // Development configuration files
      '\\.gitignore',
      '\\.github($|/)',
      '\\.vscode($|/)',
      
      // Source maps and other development artifacts
      '\\.map$',
      
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
    }
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
      
      console.log('Cleaning unnecessary files from node_modules...');
      
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
                console.log(`Removed directory: ${fullPath}`);
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
                console.log(`Removed file: ${fullPath}`);
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
      
      console.log('Finished cleaning unnecessary files.');
    }
  }
};
