// Static audit of the TypeScript the mobile app (Expo/Metro) may import from
// this repo. Walks each root's relative-import graph and reports what Metro
// cannot bundle or a phone cannot run: Vite's `import.meta` syntax, web
// workers, stylesheet imports, DOM/Electron/extension globals, Web Audio, and
// packages that must not be duplicated or do not exist on a phone.
//
// Scope and limits: comments are stripped before anything is matched; string
// contents are not, so a global named inside a string literal is still a
// finding. Type-only statements (`import type`, `export type … from`) are
// skipped; a value import that happens to carry only `type` specifiers is
// treated as a value import. Path aliases (`@/…`) are not resolved and show up
// as packages. A file that declares its own `window` variable is exempt from
// the `window` flag as a whole.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FLAGS = {
  'import.meta': /import\.meta\b/,
  'worker': /new\s+Worker\s*\(|\?worker\b/,
  'stylesheet import': /(?:^|[;\n])\s*import\s*['"][^'"]+\.s?css['"]|from\s*['"][^'"]+\.s?css['"]/,
  // A member access, not the word in prose: an identifier must follow the dot.
  'window': /(?<![\w.$])window\.[A-Za-z_$]/,
  'document': /(?<![\w.$])document\.[A-Za-z_$]/,
  'navigator': /(?<![\w.$])navigator\.[A-Za-z_$]/,
  'chrome extension API': /(?<![\w.$])chrome\.[A-Za-z_$]/,
  'web storage': /(?<![\w.$])(?:localStorage|sessionStorage|indexedDB)\b/,
  'Web Audio': /\b(?:AudioContext|AudioWorkletNode|MediaStream|getUserMedia)\b/,
};
export const FORBIDDEN_PACKAGES = new Set([
  'react', 'react-dom', 'posthog-js', 'electron', 'i18next-browser-languagedetector', 'vite',
]);

const LOCAL_WINDOW_RE = /\b(?:const|let|var)\s+window\b|\bwindow\s*(?::|=[^=])/;
// A static import/export-from clause: names, braces, commas, `* as`, newlines; never `=`, `(`, `;` or quotes,
// so an `export const` statement cannot be swallowed up to a later `from`.
const STATIC_RE = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]/g;
const BARE_RE = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Source without `//` and `/* *\/` comments; strings (including templates) are left intact. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 2; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

/** The value-import specifiers of a (comment-stripped) module source. */
export function importSpecifiers(src) {
  const specs = [];
  for (const m of src.matchAll(STATIC_RE)) {
    if (m[2]) continue; // `import type …` / `export type … from`
    specs.push(m[4]);
  }
  for (const m of src.matchAll(BARE_RE)) specs.push(m[1]);
  for (const m of src.matchAll(DYNAMIC_RE)) specs.push(m[1]);
  return specs;
}

function resolveFile(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), `${base}.json`];
  const m = /^(.*)\.(?:m?js)$/.exec(base);
  if (m) candidates.push(`${m[1]}.ts`, `${m[1]}.tsx`);
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function resolveRelative(from, spec) {
  return resolveFile(normalize(join(dirname(from), spec)));
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Audit one root (a file, with or without extension, or a directory with an index). */
export function auditRoot(repoRoot, root) {
  const findings = [];
  const packages = new Map();
  const start = resolveFile(join(repoRoot, root));
  if (!start) return { files: [], packages: {}, findings: [{ file: root, flag: 'missing file' }] };
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    const rel = relative(repoRoot, file);
    const src = stripComments(readFileSync(file, 'utf8'));
    const localWindow = LOCAL_WINDOW_RE.test(src);
    for (const [name, re] of Object.entries(FLAGS)) {
      if (name === 'window' && localWindow) continue;
      if (re.test(src)) findings.push({ file: rel, flag: name });
    }
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) stack.push(resolved);
        else findings.push({ file: rel, flag: `unresolved import '${spec}'` });
        continue;
      }
      const pkg = packageName(spec);
      if (!packages.has(pkg)) packages.set(pkg, new Set());
      packages.get(pkg).add(rel);
      if (FORBIDDEN_PACKAGES.has(pkg)) findings.push({ file: rel, flag: `package ${pkg}` });
    }
  }
  return {
    files: [...seen].map((f) => relative(repoRoot, f)).sort(),
    packages: Object.fromEntries([...packages].map(([k, v]) => [k, [...v].sort()])),
    findings,
  };
}

/** Audit many roots; returns only the roots with findings, keyed by root. */
export function auditRoots(repoRoot, roots) {
  const bad = {};
  for (const root of roots) {
    const { findings } = auditRoot(repoRoot, root);
    if (findings.length) bad[root] = findings.map((f) => `${f.file}: ${f.flag}`);
  }
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const [repoRoot, ...roots] = process.argv.slice(2);
  for (const root of roots) {
    const r = auditRoot(repoRoot, root);
    console.log(`== ${root}: ${r.files.length} files; packages: ${Object.keys(r.packages).join(', ') || '(none)'}`);
    for (const f of r.findings) console.log(`   ${f.file}: ${f.flag}`);
    if (!r.findings.length) console.log('   clean');
    else process.exitCode = 1;
  }
}
