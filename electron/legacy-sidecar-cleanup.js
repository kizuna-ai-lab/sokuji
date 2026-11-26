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

/** The real path of `p`, also when it does not exist yet: the nearest existing ancestor's, plus the rest. null if none. */
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Where the engine may keep its models, from the environment it will run with (HF_HUB_CACHE wins over HF_HOME). */
function modelCachePaths(env) {
  const paths = [env.HF_HUB_CACHE, env.HUGGINGFACE_HUB_CACHE, env.HF_HOME];
  if (env.HF_HOME) paths.push(path.join(env.HF_HOME, 'hub'));
  return paths.filter(Boolean);
}

/**
 * Removes the Python sidecar bundle an older build left in userData/sidecar (hundreds of MB). Never throws; models in
 * userData/hf-cache are not touched.
 */
async function removeLegacySidecar(userDataDir, { rm = (p) => fs.promises.rm(p, { recursive: true, force: true }), log = () => {}, keep = [] } = {}) {
  const dir = path.join(userDataDir, 'sidecar');
  try {
    if (!fs.existsSync(dir)) return;
    // A model cache the user pointed inside the old tree is theirs, not the sidecar's: leave the whole tree. Compared by
    // real path (symlinks followed on both sides); a path that cannot be resolved at all counts as inside — losing models
    // is worse than keeping a few hundred MB.
    const dirReal = realish(dir);
    const inside = keep.filter(Boolean).find((k) => {
      const r = realish(k);
      return dirReal === null || r === null || r === dirReal || r.startsWith(dirReal + path.sep);
    });
    if (inside) {
      log('warn', `[engine] kept the old sidecar folder: the model cache ${inside} may live inside it`);
      return;
    }
    const bytes = await dirBytes(dir);
    await rm(dir);
    log('info', `[engine] removed the old Python sidecar bundle (${Math.round(bytes / 1048576)} MB)`);
  } catch (e) {
    log('warn', `[engine] could not remove the old Python sidecar bundle: ${e && e.message}`);
  }
}

module.exports = { removeLegacySidecar, modelCachePaths };
