const path = require('path');

// Map the current machine to a bundle SKU (spec §7). Platform-named SKUs match
// the python builder's manifest keys: linux-x64, linux-arm64, win-x64,
// mac-arm64, mac-x64. Vulkan/Metal cover every GPU vendor uniformly now
// (the ONNX/DirectML/CUDA backends are gone), so there is no GPU-vendor probe
// here anymore — the SKU is a pure function of platform + arch.
function detectSku(platform, { arch }) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : (arch === 'x64' ? 'mac-x64' : null);
  // linux arm64 (Jetson, DGX Spark) has its own bundle: CPU + ggml/Vulkan
  // acceleration.
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  // Every remaining linux/windows bundle is x86_64 (SKU_TRIPLE in the builder).
  // On other arches (Windows-on-ARM, riscv64) an x86_64 bundle would download
  // and install fine, then die at spawn with an exec-format error — return null
  // so the UI shows the honest "unsupported" card instead.
  if (arch !== 'x64') return null;
  if (platform === 'win32') return 'win-x64';
  // M-1: only linux gets the x64 bundle -- any other platform (freebsd, aix,
  // sunos, ...) has no bundle at all, and would previously fall through to
  // 'linux-x64' here and die at spawn with an exec-format error.
  if (platform === 'linux') return 'linux-x64';
  return null;
}

function bundleRootFor(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

module.exports = { detectSku, bundleRootFor };
