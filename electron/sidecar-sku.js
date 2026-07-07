const path = require('path');

// Map the current machine to a bundle SKU (spec D10). Long OS-specific SKUs match
// the python builder's manifest keys (linux-nvidia/win-nvidia/win-directml/mac).
// NVML is gone (D7); NVIDIA presence is probed with nvidia-smi and passed in.
function detectSku(platform, { hasNvidia, arch }) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac' : null;  // only the arm64 mac bundle exists
  if (hasNvidia) return platform === 'win32' ? 'win-nvidia' : 'linux-nvidia';  // CUDA
  if (platform === 'win32') return 'win-directml';                    // non-NVIDIA Windows
  return 'linux-nvidia';  // non-NVIDIA Linux: nvidia bundle w/ CPU fallback (D10)
}

let _nvidiaProbe;  // memoized once per process — GPU presence is fixed at runtime
function probeNvidia() {
  if (_nvidiaProbe === undefined) _nvidiaProbe = _probeNvidiaUncached();
  return _nvidiaProbe;
}

function _probeNvidiaUncached() {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('nvidia-smi', ['-L'], { timeout: 4000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function bundleRootFor(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

module.exports = { detectSku, probeNvidia, bundleRootFor };
