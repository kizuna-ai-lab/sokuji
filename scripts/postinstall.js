const { execSync } = require('node:child_process');

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const isWebBuild = process.env.EBURON_BUILD_TARGET === 'web';

if (isVercel || isWebBuild) {
  console.log('[postinstall] Skipping electron-rebuild for web deployment.');
  process.exit(0);
}

execSync('npx electron-rebuild', { stdio: 'inherit' });
