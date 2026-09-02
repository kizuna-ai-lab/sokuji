// electron/sidecar-sku.consistency.test.js
//
// `sidecar-bundle.js` keeps a hand-written `KNOWN_SKUS` set that mirrors
// `sidecar-sku.js`'s `detectSku` output vocabulary. It is deliberately a copy and
// not an import (sidecar-sku.js is main-process-only; sidecar-bundle.js is also
// loaded from plain-node tests), which means nothing makes the two move together.
//
// Drift is quiet where it hurts. `KNOWN_SKUS` gates `isInstallArtifactDir`, the
// exemption that keeps `pruneStaleSkuDirs` from deleting `<sku>.tmp` — the directory a
// multi-GB install is actively extracting into — and `<sku>.old`, the rollback copy.
// Add a SKU to detectSku and forget this set, and on exactly that new platform an
// in-flight install becomes deletable mid-extraction by any `sidecar-bundle:status`
// call. Every test stays green, because no test runs on that platform.
//
// So: enumerate detectSku over a wide platform x arch cross product and require the
// set of non-null results to equal KNOWN_SKUS, exactly — no missing entries, and no
// stale ones left behind by a rename.
import { describe, it, expect } from 'vitest';
import { detectSku } from './sidecar-sku.js';
import { KNOWN_SKUS } from './sidecar-bundle.js';

// Everything process.platform and process.arch can be in a Node/Electron build,
// plus a few nonsense values, so a SKU cannot hide behind an unlisted combination.
const PLATFORMS = ['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux',
                   'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd'];
const ARCHES = ['arm', 'arm64', 'ia32', 'loong64', 'mips', 'mipsel', 'ppc',
                'ppc64', 'riscv64', 's390', 's390x', 'x64'];

function detectedSkus() {
  const out = new Set();
  for (const platform of PLATFORMS) {
    for (const arch of ARCHES) {
      const sku = detectSku(platform, { arch });
      if (sku !== null && sku !== undefined) out.add(sku);
    }
  }
  return out;
}

describe('KNOWN_SKUS mirrors detectSku exactly', () => {
  it('every SKU detectSku can return is in KNOWN_SKUS', () => {
    const missing = [...detectedSkus()].filter((s) => !KNOWN_SKUS.has(s));
    expect(missing).toEqual([]);
  });

  it('KNOWN_SKUS carries nothing detectSku can never return', () => {
    const detected = detectedSkus();
    const stale = [...KNOWN_SKUS].filter((s) => !detected.has(s));
    expect(stale).toEqual([]);
  });

  it('the two sets are equal, and non-empty', () => {
    expect([...detectedSkus()].sort()).toEqual([...KNOWN_SKUS].sort());
    expect(KNOWN_SKUS.size).toBeGreaterThan(0);
  });
});
