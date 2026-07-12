const path = require('path');

// Map the current machine to a bundle SKU (spec D10). Long OS-specific SKUs match
// the python builder's manifest keys (linux-nvidia/win-nvidia/win-directml/mac).
// NVML is gone (D7); NVIDIA presence is probed with nvidia-smi and passed in.
function detectSku(platform, { hasNvidia, arch }) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac' : null;  // only the arm64 mac bundle exists
  // linux arm64 (Jetson, DGX Spark) has its own bundle: CPU ORT + ggml/Vulkan
  // acceleration, NVIDIA or not (onnxruntime-gpu ships no aarch64 wheels).
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  // Every remaining linux/windows bundle is x86_64 (SKU_TRIPLE in the builder).
  // On other arches (Windows-on-ARM, riscv64) an x86_64 bundle would download
  // and install fine, then die at spawn with an exec-format error — return null
  // so the UI shows the honest "unsupported" card instead (same as Intel mac).
  if (arch !== 'x64') return null;
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

// "GPU 0: NVIDIA GeForce RTX 4070 (UUID: GPU-...)" -> "NVIDIA GeForce RTX 4070"
function parseGpuName(stdout) {
  const m = /^GPU \d+:\s*(.+?)\s*\(/m.exec(stdout || '');
  return m ? m[1] : null;
}

let _gpuName;  // memoized once per process, like probeNvidia
function nvidiaGpuName() {
  if (_gpuName !== undefined) return _gpuName;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('nvidia-smi', ['-L'], { timeout: 4000, encoding: 'utf8' });
    _gpuName = r.status === 0 ? parseGpuName(r.stdout) : null;
  } catch {
    _gpuName = null;
  }
  return _gpuName;
}

function bundleRootFor(userDataDir, sku) {
  return path.join(userDataDir, 'sidecar', sku);
}

module.exports = { detectSku, probeNvidia, bundleRootFor, parseGpuName, nvidiaGpuName };
