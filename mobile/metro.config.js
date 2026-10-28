const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
// The desktop's platform-neutral modules, imported as `@shared/...`.
config.watchFolders = [path.join(root, 'src')];
config.resolver.extraNodeModules = { '@shared': path.join(root, 'src') };
// This app's node_modules first; the desktop's only for what the shared
// modules import themselves (never react).
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
// Tailwind classes through NativeWind (the styling engine React Native Reusables' components are written for).
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
