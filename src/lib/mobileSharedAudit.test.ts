// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditRoot } from '../../scripts/mobile-shared-audit.mjs';

// The audit itself, on a throwaway tree: what it must catch and what it must resolve.
let repo: string;
const write = (rel: string, src: string) => {
  const p = join(repo, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, src);
};
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'mobile-shared-audit-'));
  write('src/a.ts', "import './style.css';\nexport const a = 1;\n");
  write('src/style.css', '');
  write('src/b.ts', "export async function b() { const m = await import('./vite-only'); return m; }\n");
  write('src/vite-only.ts', 'export const mode = import.meta.env.MODE;\n');
  write('src/c.ts', "export const c = require('./vite-only');\n");
  write('src/clean.ts', 'export const clean = 1;\n');
  write('src/multi.ts', "import {\n  mode,\n} from './vite-only';\nexport const m = mode;\n");
  write('src/commented.ts', "// window.location is never touched here; import.meta neither\n/* document.body */\nexport const k = 1;\n");
  write('src/unresolved.ts', "import { x } from './does-not-exist';\nexport const u = x;\n");
  write('src/jsspec.ts', "import { mode } from './vite-only.js';\nexport const j = mode;\n");
  write('src/dir/index.ts', 'export const d = 1;\n');
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('mobile-shared-audit', () => {
  it('flags a bare stylesheet import', () => {
    const { findings } = auditRoot(repo, 'src/a.ts');
    expect(findings).toContainEqual({ file: 'src/a.ts', flag: 'stylesheet import' });
  });

  it('follows a dynamic import inside an expression', () => {
    const { findings } = auditRoot(repo, 'src/b.ts');
    expect(findings).toContainEqual({ file: 'src/vite-only.ts', flag: 'import.meta' });
  });

  it('follows a require call', () => {
    const { findings } = auditRoot(repo, 'src/c.ts');
    expect(findings).toContainEqual({ file: 'src/vite-only.ts', flag: 'import.meta' });
  });

  it('resolves an extensionless root and a directory root', () => {
    expect(auditRoot(repo, 'src/clean').findings).toEqual([]);
    expect(auditRoot(repo, 'src/dir').findings).toEqual([]);
    expect(auditRoot(repo, 'src/dir').files).toEqual(['src/dir/index.ts']);
  });

  it('follows a multi-line import statement', () => {
    const { findings } = auditRoot(repo, 'src/multi.ts');
    expect(findings).toContainEqual({ file: 'src/vite-only.ts', flag: 'import.meta' });
  });

  it('ignores globals named only in comments', () => {
    expect(auditRoot(repo, 'src/commented.ts').findings).toEqual([]);
  });

  it('reports a relative import that resolves to nothing', () => {
    expect(auditRoot(repo, 'src/unresolved.ts').findings).toEqual([{ file: 'src/unresolved.ts', flag: "unresolved import './does-not-exist'" }]);
  });

  it('resolves an ESM-style .js specifier to the .ts source', () => {
    const { findings } = auditRoot(repo, 'src/jsspec.ts');
    expect(findings).toContainEqual({ file: 'src/vite-only.ts', flag: 'import.meta' });
  });

  it('reports a root that does not exist', () => {
    expect(auditRoot(repo, 'src/nope.ts').findings).toEqual([{ file: 'src/nope.ts', flag: 'missing file' }]);
  });
});
