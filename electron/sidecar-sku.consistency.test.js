// electron/sidecar-sku.consistency.test.js
//
// `detectSku` names the platforms the app has a native archive for, and scripts/native-archives.json holds one sha256
// per such archive. The two are written by hand in different places, so nothing makes them move together: add a SKU to
// detectSku and forget the hashes, and `npm run fetch:native` fails on exactly that new platform, where no CI job runs.
// Enumerate detectSku over a wide platform x arch cross product and require the set of non-null results to equal the
// SKUs in native-archives.json, exactly — none missing, none left behind by a rename.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { detectSku } from './sidecar-sku.js';

const archives = createRequire(import.meta.url)('../scripts/native-archives.json');

// Everything process.platform and process.arch can be in a Node/Electron build, plus a few nonsense values, so a SKU
// cannot hide behind an unlisted combination.
const PLATFORMS = ['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux',
                   'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd'];
const ARCHES = ['arm', 'arm64', 'ia32', 'loong64', 'mips', 'mipsel', 'ppc',
                'ppc64', 's390', 's390x', 'x64', 'riscv64'];

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

describe('native-archives.json mirrors detectSku exactly', () => {
  it('every detectable SKU has a sha256, and no sha256 is for an undetectable SKU', () => {
    expect([...detectedSkus()].sort()).toEqual(Object.keys(archives.sha256).sort());
  });

  it('every sha256 is 64 hex digits', () => {
    for (const [sku, sum] of Object.entries(archives.sha256)) expect(sum, sku).toMatch(/^[0-9a-f]{64}$/);
  });
});
