// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The overlay must not boot the app (shared/index.tsx renders it at load) or carry the
// provider registry (ruling of 2026-10-15). Static imports only; lazy chunks are fine.
const ROOT = path.resolve(__dirname);
const ENTRY = path.join(ROOT, 'subtitle-overlay-entry.tsx');
const FORBIDDEN = [path.join(ROOT, '../shared/index.tsx'), path.join(ROOT, 'stores/providerStore.ts')];
const ASSET = /\.(scss|css|svg|json|png|jpg|woff2?)(\?.*)?$|\?url$/;

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[2]) continue;
    if (m[1] === 'export' && !m[3]) continue;
    out.push(m[4]);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

describe('the subtitle overlay entry', () => {
  it('does not statically reach the app entry or the provider store', () => {
    const parent = new Map<string, string | null>([[ENTRY, null]]);
    const queue = [ENTRY];
    while (queue.length) {
      const file = queue.shift()!;
      for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.') || ASSET.test(spec)) continue;
        const next = resolve(file, spec);
        if (!next || parent.has(next)) continue;
        parent.set(next, file);
        queue.push(next);
      }
    }
    const hits = FORBIDDEN.filter((f) => parent.has(f)).map((f) => {
      const chain: string[] = [];
      for (let cur: string | null | undefined = f; cur; cur = parent.get(cur)) chain.unshift(path.relative(ROOT, cur));
      return chain.join(' -> ');
    });
    expect(hits).toEqual([]);
  });
});
