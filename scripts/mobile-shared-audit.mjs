// Static audit of the TypeScript the mobile app (Expo/Metro) may import from
// this repo. Walks each root's relative-import graph and reports what Metro
// cannot bundle or a phone cannot run: `import.meta` (Vite-only syntax),
// web workers, stylesheet imports, DOM/Electron/extension globals, Web Audio,
// and packages that must not be duplicated or do not exist on a phone.
// Type-only imports are skipped: they vanish at build time.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const IMPORT_RE = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\s/;
const LOCAL_WINDOW_RE = /\b(?:const|let|var)\s+window\b|\bwindow\s*(?::|=[^=])/;
export const FLAGS = {
  'import.meta': /import\.meta/,
  'worker': /new\s+Worker\(|\?worker\b/,
  'stylesheet import': /from\s+['"][^'"]+\.s?css['"]/,
  // A member access, not the word in prose ("its own window."): an identifier must follow the dot.
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

function resolveRelative(from, spec) {
  const base = normalize(join(dirname(from), spec));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), `${base}.json`]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Audit one root. Returns { files, packages, findings } with repo-relative paths. */
export function auditRoot(repoRoot, root) {
  const start = join(repoRoot, root);
  const seen = new Set();
  const stack = [start];
  const packages = new Map();
  const findings = [];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    const rel = relative(repoRoot, file);
    if (!existsSync(file)) { findings.push({ file: rel, flag: 'missing file' }); continue; }
    const src = readFileSync(file, 'utf8');
    const localWindow = LOCAL_WINDOW_RE.test(src);
    for (const [name, re] of Object.entries(FLAGS)) {
      if (name === 'window' && localWindow) continue;
      if (re.test(src)) findings.push({ file: rel, flag: name });
    }
    for (const line of src.split('\n')) {
      const m = IMPORT_RE.exec(line);
      if (!m || TYPE_ONLY_RE.test(line)) continue;
      const spec = m[1] ?? m[2];
      const resolved = spec.startsWith('.') ? resolveRelative(file, spec) : null;
      if (resolved) stack.push(resolved);
      else if (!spec.startsWith('.')) {
        const pkg = packageName(spec);
        if (!packages.has(pkg)) packages.set(pkg, new Set());
        packages.get(pkg).add(rel);
        if (FORBIDDEN_PACKAGES.has(pkg)) findings.push({ file: rel, flag: `package ${pkg}` });
      }
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [repoRoot, ...roots] = process.argv.slice(2);
  for (const root of roots) {
    const r = auditRoot(repoRoot, root);
    console.log(`== ${root}: ${r.files.length} files; packages: ${Object.keys(r.packages).join(', ') || '(none)'}`);
    for (const f of r.findings) console.log(`   ${f.file}: ${f.flag}`);
    if (!r.findings.length) console.log('   clean');
  }
}
