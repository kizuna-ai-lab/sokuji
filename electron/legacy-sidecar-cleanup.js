const fs = require('fs');
const path = require('path');

async function dirBytes(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else { try { total += (await fs.promises.stat(p)).size; } catch { /* vanished */ } }
  }
  return total;
}

/**
 * Removes the Python sidecar bundle an older build left in userData/sidecar (hundreds of MB). Never throws; models in
 * userData/hf-cache are not touched.
 */
async function removeLegacySidecar(userDataDir, { rm = (p) => fs.promises.rm(p, { recursive: true, force: true }), log = () => {}, keep = [] } = {}) {
  const dir = path.join(userDataDir, 'sidecar');
  try {
    if (!fs.existsSync(dir)) return;
    // A model cache the user pointed inside the old tree (HF_HOME) is theirs, not the sidecar's: leave the whole tree.
    const inside = keep.filter(Boolean).map((k) => path.resolve(k)).find((k) => k === dir || k.startsWith(dir + path.sep));
    if (inside) {
      log('warn', `[engine] kept the old sidecar folder: the model cache ${inside} lives inside it`);
      return;
    }
    const bytes = await dirBytes(dir);
    await rm(dir);
    log('info', `[engine] removed the old Python sidecar bundle (${Math.round(bytes / 1048576)} MB)`);
  } catch (e) {
    log('warn', `[engine] could not remove the old Python sidecar bundle: ${e && e.message}`);
  }
}

module.exports = { removeLegacySidecar };
