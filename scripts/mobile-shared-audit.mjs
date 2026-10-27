// Static audit of the TypeScript the mobile app (Expo/Metro) may import from
// this repo. Walks each root's relative-import graph and reports what Metro
// cannot bundle or a phone cannot run: Vite's `import.meta` syntax, web
// workers, stylesheet imports, DOM/Electron/extension globals, Web Audio, and
// packages that must not be duplicated or do not exist on a phone.
//
// Scope and limits: comments are stripped before anything is matched, by
// TypeScript's own parser, so regex literals and templates are read as such;
// string contents are kept, so a global named inside a string literal is still
// a finding. Type-only statements (`import type`, `export type … from`) are
// skipped; a value import that happens to carry only `type` specifiers is
// treated as a value import. Path aliases (`@/…`) are not resolved and show up
// as packages. `window` is checked on the syntax tree: a read is flagged
// unless a local declaration of that name (a variable, parameter, function or
// catch binding) shadows it in an enclosing scope.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

// A static import/export-from clause: names, braces, commas, `* as`, newlines; never `=`, `(`, `;` or quotes,
// so an `export const` statement cannot be swallowed up to a later `from`.
const STATIC_RE = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]/g;
const BARE_RE = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Source without `//` and `/* *\/` comments; strings, templates and regex
 * literals are left intact. Parsed and reprinted by TypeScript: telling a
 * regex literal from a division, or a quote inside one from the start of a
 * string, takes a parser.
 */
export function stripComments(src, fileName = 'module.ts') {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false, kind);
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

const isWindow = (name) => name !== undefined && ts.isIdentifier(name) && name.text === 'window';

/** Whether this scope node itself declares a binding named `window`. */
function declaresWindow(node) {
  if (ts.isFunctionLike(node) && (isWindow(node.name) || node.parameters.some((p) => isWindow(p.name)))) return true;
  if (ts.isCatchClause(node)) return isWindow(node.variableDeclaration?.name);
  const lists = [];
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) lists.push(node.initializer);
  for (const statement of node.statements ?? []) {
    if (ts.isVariableStatement(statement)) lists.push(statement.declarationList);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && isWindow(statement.name)) return true;
  }
  return lists.some((list) => list && ts.isVariableDeclarationList(list) && list.declarations.some((d) => isWindow(d.name)));
}

/** Whether `src` reads the browser's `window` anywhere no local `window` shadows it. */
function readsGlobalWindow(src, fileName) {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
  const shadowed = (node) => {
    for (let scope = node.parent; scope; scope = scope.parent) if (declaresWindow(scope)) return true;
    return false;
  };
  const visit = (node) => {
    const access = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
    if (access && ts.isIdentifier(node.expression) && node.expression.text === 'window' && !shadowed(node)) return true;
    return ts.forEachChild(node, visit) ?? false;
  };
  return visit(file);
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
    const raw = readFileSync(file, 'utf8');
    const src = stripComments(raw, file);
    for (const [name, re] of Object.entries(FLAGS)) {
      if (!re.test(src)) continue;
      if (name === 'window' && !readsGlobalWindow(raw, file)) continue;
      findings.push({ file: rel, flag: name });
    }
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) stack.push(resolved);
        else findings.push({ file: rel, flag: `unresolved import '${spec}'` });
        continue;
      }
      // Node's own modules do not exist on a phone, with or without `node:`.
      if (isBuiltin(spec)) {
        findings.push({ file: rel, flag: `node built-in ${spec}` });
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
  if (!repoRoot || roots.length === 0) {
    // Nothing audited must not read as a pass in CI.
    console.error('usage: node scripts/mobile-shared-audit.mjs <repo-root> <root>...');
    process.exit(2);
  }
  for (const root of roots) {
    const r = auditRoot(repoRoot, root);
    console.log(`== ${root}: ${r.files.length} files; packages: ${Object.keys(r.packages).join(', ') || '(none)'}`);
    for (const f of r.findings) console.log(`   ${f.file}: ${f.flag}`);
    if (!r.findings.length) console.log('   clean');
    else process.exitCode = 1;
  }
}
