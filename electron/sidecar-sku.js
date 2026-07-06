const path = require('path');

// Map the current machine to a bundle SKU (spec D10). NVML is gone (D7); NVIDIA
// presence is probed with nvidia-smi in the main process and passed in as a bool
// so detectSku stays pure/testable.
function detectSku(platform, { hasNvidia }) {
  if (platform === 'darwin') return 'mac';            // Apple Silicon MLX lane (D5)
  if (hasNvidia) return 'nvidia';                     // CUDA on Windows or Linux
  if (platform === 'win32') return 'directml';        // non-NVIDIA Windows (D1/D2)
  return 'nvidia';                                    // non-NVIDIA Linux: nvidia bundle w/ CPU fallback (D10 open item)
}

function probeNvidia() {
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
