const path = require('path');

/**
 * The directory holding sokuji_native_node.node, the libraries and contract.json (the engine's `nativeDir`).
 * SOKUJI_NATIVE_DIR wins (tests, a local build); a packaged app has it beside its other extra resources; a dev
 * checkout has it where `npm run fetch:native` unpacks it.
 */
function resolveNativeDir({ isPackaged, resourcesPath, env = {}, repoRoot }) {
  if (env.SOKUJI_NATIVE_DIR) return env.SOKUJI_NATIVE_DIR;
  if (isPackaged) return path.join(resourcesPath, 'resources', 'native');
  return path.join(repoRoot, 'resources', 'native');
}

module.exports = { resolveNativeDir };
