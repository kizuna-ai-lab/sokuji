// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  // A quote inside a regex literal is not the start of a string.
  write('src/regex-quote.ts', "const re = /[\"']/;\n// window.alert is only named in this comment\nexport const q = re;\n");
  // Nor is a `/*` inside one the start of a comment that could hide real code.
  write('src/regex-star.ts', "const re = /a\\/*b/;\nwindow.alert(1);\nexport const s = re; /* end */\n");
  write('src/window-key.ts', "const o = { window: 1 };\nwindow.addEventListener('x', () => o);\nexport const w = o;\n");
  write('src/window-local.ts', 'export function f(tail: string) {\n  const window = tail.slice(1);\n  return window.length;\n}\n');
  // A local `window` shadows the global only in its own scope, and a string is not a declaration.
  write('src/window-shadow-elsewhere.ts', "function f() { const window = { open() {} }; return window.open(); }\nexport function g() { f(); return window.open('x'); }\n");
  write('src/window-in-string.ts', "export const s = 'const window = 1';\nexport function g() { return window.open('x'); }\n");
  write('src/node-builtin.ts', "import { readFileSync } from 'node:fs';\nimport path from 'path';\nexport const n = [readFileSync, path];\n");
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

  it('reads a regex literal with quotes in it as a regex, not a string', () => {
    expect(auditRoot(repo, 'src/regex-quote.ts').findings).toEqual([]);
  });

  it('does not let a regex literal hide the code after it', () => {
    expect(auditRoot(repo, 'src/regex-star.ts').findings).toEqual([{ file: 'src/regex-star.ts', flag: 'window' }]);
  });

  it('lets only a declaration named window shadow the global, not an object key', () => {
    expect(auditRoot(repo, 'src/window-key.ts').findings).toEqual([{ file: 'src/window-key.ts', flag: 'window' }]);
    expect(auditRoot(repo, 'src/window-local.ts').findings).toEqual([]);
  });

  it('still flags the global window outside the scope of a local one', () => {
    expect(auditRoot(repo, 'src/window-shadow-elsewhere.ts').findings).toEqual([{ file: 'src/window-shadow-elsewhere.ts', flag: 'window' }]);
    expect(auditRoot(repo, 'src/window-in-string.ts').findings).toEqual([{ file: 'src/window-in-string.ts', flag: 'window' }]);
  });

  it('flags Node built-in modules, with or without the node: prefix', () => {
    expect(auditRoot(repo, 'src/node-builtin.ts').findings).toEqual([
      { file: 'src/node-builtin.ts', flag: 'node built-in node:fs' },
      { file: 'src/node-builtin.ts', flag: 'node built-in path' },
    ]);
  });

  it('fails when run with nothing to audit, rather than reporting a pass', () => {
    const script = resolve(__dirname, '../../scripts/mobile-shared-audit.mjs');
    expect(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status).not.toBe(0);
    expect(spawnSync(process.execPath, [script, repo], { encoding: 'utf8' }).status).not.toBe(0);
  });
});
